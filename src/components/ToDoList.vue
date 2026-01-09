<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
console.log("MODE:", import.meta.env.MODE);
console.log("BASE:", import.meta.env.VITE_API_BASE_URL);

type Filter = "all" | "active" | "done";
type BackendStatus = "loading" | "ok" | "error";

type Task = {
  id: number;
  title: string;
  done: boolean;
  createdAt: number; // ms timestamp
};

const STORAGE_KEY = "taskbuddy_tasks_cache_v1";

// Base URL (lokal / prod über .env)
const API_BASE = String(import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
const TODOS_URL = `${API_BASE}/api/todos`;
const PING_URL = `${API_BASE}/TaskBuddy`;

// ===== UI State =====
const tasks = ref<Task[]>([]);
const newTask = ref("");
const filter = ref<Filter>("all");

// Backend badge
const backendStatus = ref<BackendStatus>("loading");
const backendMessage = ref<string>("");

// Inline edit
const editingId = ref<number | null>(null);
const editValue = ref("");
const editInputRef = ref<HTMLInputElement | null>(null);

// Toast + Undo
const toastOpen = ref(false);
const toastMessage = ref("");
let toastTimer: number | null = null;

// Für Undo: wir löschen erst nach Delay wirklich im Backend
let pendingDeleteTimer: number | null = null;
let pendingDelete: { task: Task; index: number } | null = null;

// ===== Helpers =====
function uid() {
  return Date.now() + Math.floor(Math.random() * 1000);
}

function formatDate(ts: number) {
  return new Date(ts).toLocaleDateString();
}

function showToast(msg: string) {
  toastOpen.value = true;
  toastMessage.value = msg;
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toastOpen.value = false;
    toastMessage.value = "";
  }, 5500);
}

function closeToast() {
  toastOpen.value = false;
  toastMessage.value = "";
  if (toastTimer) {
    window.clearTimeout(toastTimer);
    toastTimer = null;
  }
}

// cache (falls Backend mal down ist)
function saveCache() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks.value));
}
function loadCache(): Task[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Task[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((t) => t && typeof t.id === "number" && typeof t.title === "string")
      .map((t) => ({
        id: t.id,
        title: String(t.title),
        done: Boolean(t.done),
        createdAt: typeof (t as any).createdAt === "number" ? (t as any).createdAt : Date.now(),
      }));
  } catch {
    return [];
  }
}

// ===== API =====
async function apiGetTodos(): Promise<Task[]> {
  const res = await fetch(TODOS_URL, { method: "GET" });
  if (!res.ok) throw new Error(`GET failed (${res.status})`);
  const data = (await res.json()) as Array<{ id: number; title: string; done: boolean; createdAt?: number | null }>;
  return data.map((t) => ({
    id: t.id,
    title: t.title,
    done: t.done,
    createdAt: typeof t.createdAt === "number" ? t.createdAt : Date.now(),
  }));
}

async function apiCreateTodo(payload: Omit<Task, "id">): Promise<Task> {
  const res = await fetch(TODOS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`POST failed (${res.status})`);
  const t = (await res.json()) as { id: number; title: string; done: boolean; createdAt?: number | null };
  return { id: t.id, title: t.title, done: t.done, createdAt: typeof t.createdAt === "number" ? t.createdAt : payload.createdAt };
}

async function apiUpdateTodo(id: number, patch: Partial<Pick<Task, "title" | "done">>): Promise<Task> {
  const res = await fetch(`${TODOS_URL}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`PUT failed (${res.status})`);
  const t = (await res.json()) as { id: number; title: string; done: boolean; createdAt?: number | null };
  return { id: t.id, title: t.title, done: t.done, createdAt: typeof t.createdAt === "number" ? t.createdAt : Date.now() };
}

async function apiDeleteTodo(id: number): Promise<void> {
  const res = await fetch(`${TODOS_URL}/${id}`, { method: "DELETE" });
  if (!res.ok && res.status !== 204) throw new Error(`DELETE failed (${res.status})`);
}

// Backend Badge/Ping
async function fetchBackendBadge() {
  backendStatus.value = "loading";
  backendMessage.value = "";

  try {
    const controller = new AbortController();
    const t = window.setTimeout(() => controller.abort(), 8000);

    const res = await fetch(PING_URL, { method: "GET", signal: controller.signal });
    window.clearTimeout(t);

    if (!res.ok) {
      backendStatus.value = "error";
      backendMessage.value = `Offline (HTTP ${res.status})`;
      return;
    }

    const text = (await res.text()).trim();
    backendStatus.value = "ok";
    backendMessage.value = text || "Online";
  } catch {
    backendStatus.value = "error";
    backendMessage.value = "Offline";
  }
}

// ===== CRUD (optimistisch) =====
async function loadFromBackend() {
  try {
    const data = await apiGetTodos();
    tasks.value = data;
  } catch {
    // fallback cache
    tasks.value = loadCache();
    showToast("Backend nicht erreichbar — Cache geladen");
  }
}

async function addTask() {
  const title = newTask.value.trim();
  if (!title) return;

  const tempId = -uid(); // temporär negativ
  const optimistic: Task = {
    id: tempId,
    title,
    done: false,
    createdAt: Date.now(),
  };

  tasks.value.unshift(optimistic);
  newTask.value = "";

  try {
    const saved = await apiCreateTodo({ title: optimistic.title, done: false, createdAt: optimistic.createdAt });
    // replace temp
    const idx = tasks.value.findIndex((t) => t.id === tempId);
    if (idx !== -1) tasks.value.splice(idx, 1, saved);
  } catch {
    // rollback
    tasks.value = tasks.value.filter((t) => t.id !== tempId);
    showToast("Konnte Task nicht speichern (Backend offline?)");
  }
}

async function toggleDone(id: number) {
  const t = tasks.value.find((x) => x.id === id);
  if (!t) return;

  const prev = t.done;
  t.done = !t.done;

  // temp ids nicht updaten (noch nicht gespeichert)
  if (id < 0) return;

  try {
    const updated = await apiUpdateTodo(id, { done: t.done });
    t.title = updated.title;
    t.done = updated.done;
  } catch {
    t.done = prev;
    showToast("Update fehlgeschlagen");
  }
}

function scheduleBackendDelete(id: number) {
  // in case another delete is pending, execute it now
  if (pendingDeleteTimer) {
    window.clearTimeout(pendingDeleteTimer);
    pendingDeleteTimer = null;
  }

  pendingDeleteTimer = window.setTimeout(async () => {
    if (!pendingDelete) return;
    const realId = pendingDelete.task.id;
    pendingDelete = null;

    if (realId < 0) return; // war nur temp
    try {
      await apiDeleteTodo(realId);
    } catch {
      showToast("Backend-Löschen fehlgeschlagen");
    }
  }, 5000);
}

function deleteTask(id: number) {
  const idx = tasks.value.findIndex((t) => t.id === id);
  if (idx === -1) return;

  const removed = tasks.value[idx];
  tasks.value.splice(idx, 1);

  // pending delete merken + delay (Undo möglich)
  pendingDelete = { task: removed, index: idx };
  scheduleBackendDelete(id);

  showToast(`Task gelöscht: “${removed.title}” (Undo möglich)`);
}

function undoDelete() {
  if (!pendingDelete) return;

  // cancel backend delete
  if (pendingDeleteTimer) {
    window.clearTimeout(pendingDeleteTimer);
    pendingDeleteTimer = null;
  }

  tasks.value.splice(pendingDelete.index, 0, pendingDelete.task);
  pendingDelete = null;

  showToast("Wiederhergestellt ✅");
}

async function commitEdit(task: Task) {
  const nextTitle = editValue.value.trim();
  if (!nextTitle) {
    cancelEdit();
    return;
  }

  const prevTitle = task.title;
  task.title = nextTitle;
  cancelEdit();

  if (task.id < 0) return;

  try {
    const updated = await apiUpdateTodo(task.id, { title: nextTitle, done: task.done });
    task.title = updated.title;
    task.done = updated.done;
  } catch {
    task.title = prevTitle;
    showToast("Edit speichern fehlgeschlagen");
  }
}

async function clearCompleted() {
  const doneTasks = tasks.value.filter((t) => t.done);
  if (doneTasks.length === 0) return;

  // optimistisch: UI sofort
  const prev = [...tasks.value];
  tasks.value = tasks.value.filter((t) => !t.done);

  try {
    // delete done in backend (serial für simplicity)
    for (const t of doneTasks) {
      if (t.id > 0) await apiDeleteTodo(t.id);
    }
    showToast("Erledigte Tasks entfernt");
  } catch {
    tasks.value = prev;
    showToast("Clear done fehlgeschlagen");
  }
}

// ===== Inline Edit =====
async function startEdit(task: Task) {
  editingId.value = task.id;
  editValue.value = task.title;
  await nextTick();
  editInputRef.value?.focus();
  editInputRef.value?.select();
}
function cancelEdit() {
  editingId.value = null;
  editValue.value = "";
}

// ===== Derived =====
const remaining = computed(() => tasks.value.filter((t) => !t.done).length);
const completed = computed(() => tasks.value.filter((t) => t.done).length);
const hasCompleted = computed(() => completed.value > 0);

const filteredTasks = computed(() => {
  if (filter.value === "active") return tasks.value.filter((t) => !t.done);
  if (filter.value === "done") return tasks.value.filter((t) => t.done);
  return tasks.value;
});

const emptyText = computed(() => {
  if (filter.value === "active") return "Keine offenen Tasks ✨";
  if (filter.value === "done") return "Noch nichts erledigt — let’s go 💪";
  return "Noch keine Tasks — leg los 🚀";
});

// ESC cancels edit / closes toast
function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") {
    if (editingId.value !== null) cancelEdit();
    else if (toastOpen.value) closeToast();
  }
}

// ===== Lifecycle =====
onMounted(async () => {
  await loadFromBackend();
  await fetchBackendBadge();
  window.addEventListener("keydown", onKeydown);
});

watch(tasks, () => saveCache(), { deep: true });

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
  if (toastTimer) window.clearTimeout(toastTimer);
  if (pendingDeleteTimer) window.clearTimeout(pendingDeleteTimer);
});
</script>

<template>
  <section class="wrap">
    <div class="card">
      <header class="header">
        <div class="headerTop">
          <h2 class="title">📝 TaskBuddy</h2>
          <span class="pill">{{ remaining }} offen</span>
        </div>

        <p class="subtitle">Professionell organisiert — schnell, clean, zuverlässig.</p>

        <div class="backend" :class="backendStatus">
          <span class="badge">Backend</span>

          <span v-if="backendStatus === 'loading'" class="statusRow">
            <span class="spinner" aria-hidden="true"></span>
            <span class="backendText">Connecting…</span>
          </span>

          <span v-else class="statusRow">
            <span class="dot" aria-hidden="true"></span>
            <span class="backendText">{{ backendMessage }}</span>
          </span>

          <button class="retry" type="button" @click="fetchBackendBadge" :disabled="backendStatus === 'loading'">
            Retry
          </button>
        </div>
      </header>

      <div class="composer">
        <label class="srOnly" for="newTask">Neue Aufgabe</label>
        <input
          id="newTask"
          v-model="newTask"
          class="input"
          type="text"
          autocomplete="off"
          placeholder="Neue Aufgabe eingeben…"
          @keydown.enter="addTask"
        />
        <button class="btn" type="button" @click="addTask">Add</button>
      </div>

      <nav class="filters" aria-label="Filter">
        <button class="chip" :class="{ active: filter === 'all' }" @click="filter = 'all'" type="button">
          All <span class="chipCount">{{ tasks.length }}</span>
        </button>
        <button class="chip" :class="{ active: filter === 'active' }" @click="filter = 'active'" type="button">
          Active <span class="chipCount">{{ remaining }}</span>
        </button>
        <button class="chip" :class="{ active: filter === 'done' }" @click="filter = 'done'" type="button">
          Done <span class="chipCount">{{ completed }}</span>
        </button>

        <button class="chip danger" type="button" :disabled="!hasCompleted" @click="clearCompleted">
          Clear done
        </button>
      </nav>

      <div class="list">
        <transition-group name="fade" tag="ul" class="ul">
          <li v-for="task in filteredTasks" :key="task.id" class="item" :class="{ done: task.done }">
            <button class="check" type="button" @click="toggleDone(task.id)" :aria-label="task.done ? 'open' : 'done'">
              <span class="box" aria-hidden="true"></span>
            </button>

            <div class="content" @dblclick="startEdit(task)">
              <template v-if="editingId === task.id">
                <input
                  ref="editInputRef"
                  v-model="editValue"
                  class="editInput"
                  type="text"
                  @keydown.enter="commitEdit(task)"
                  @keydown.esc="cancelEdit"
                  @blur="commitEdit(task)"
                />
              </template>
              <template v-else>
                <p class="text" :title="task.title">{{ task.title }}</p>
                <p class="meta">{{ task.done ? "Erledigt" : "Offen" }} • {{ formatDate(task.createdAt) }}</p>
              </template>
            </div>

            <button class="iconBtn" type="button" @click="deleteTask(task.id)" aria-label="delete">
              🗑
            </button>
          </li>
        </transition-group>

        <p v-if="filteredTasks.length === 0" class="empty">{{ emptyText }}</p>
      </div>

      <footer class="footer">
        <span class="muted">{{ remaining }} offen • {{ completed }} erledigt</span>
        <span class="muted">Doppelklick zum Bearbeiten</span>
      </footer>
    </div>

    <div v-if="toastOpen" class="toast" role="status" aria-live="polite">
      <span class="toastText">{{ toastMessage }}</span>
      <button class="toastBtn" type="button" @click="undoDelete" :disabled="!pendingDelete">Undo</button>
      <button class="toastBtn ghost" type="button" @click="closeToast">Close</button>
    </div>
  </section>
</template>

<style scoped>
.wrap { width: min(960px, 92vw); padding: 24px; }
.card {
  background: var(--color-background-soft);
  border: 1px solid var(--color-border);
  border-radius: 18px;
  overflow: hidden;
  box-shadow: var(--shadow, 0 18px 45px rgba(0, 0, 0, 0.12));
}
.header { padding: 22px 22px 14px; border-bottom: 1px solid var(--color-border); background: var(--color-background); }
.headerTop { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.title { font-size: 20px; font-weight: 900; letter-spacing: -0.02em; color: var(--color-heading); }
.subtitle { margin-top: 6px; font-size: 13px; color: var(--color-text); opacity: 0.85; }
.pill { border: 1px solid var(--color-border); background: var(--color-background-soft); color: var(--color-text); padding: 6px 10px; border-radius: 999px; font-size: 12px; }

.backend { margin-top: 12px; display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 12px; border: 1px solid var(--color-border); background: var(--color-background-soft); }
.backend.loading { opacity: 0.92; }
.backend.ok { border-color: rgba(66, 184, 131, 0.25); }
.backend.error { border-color: rgba(239, 68, 68, 0.25); }

.badge { font-size: 12px; font-weight: 800; padding: 4px 8px; border-radius: 999px; border: 1px solid var(--color-border); background: var(--color-background); color: var(--color-text); }
.statusRow { display: inline-flex; align-items: center; gap: 8px; min-width: 0; flex: 1; }
.backendText { font-size: 13px; color: var(--color-text); opacity: 0.9; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.dot { width: 10px; height: 10px; border-radius: 999px; background: rgba(255, 255, 255, 0.35); box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.06); }
.backend.ok .dot { background: var(--accent); box-shadow: 0 0 0 3px rgba(66, 184, 131, 0.22); }
.backend.error .dot { background: #ef4444; box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.18); }

.spinner { width: 14px; height: 14px; border-radius: 999px; border: 2px solid rgba(255, 255, 255, 0.18); border-top-color: var(--accent); animation: spin 0.7s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.retry { margin-left: auto; padding: 7px 10px; border-radius: 10px; border: 1px solid var(--color-border); background: transparent; color: var(--color-text); cursor: pointer; font-weight: 700; font-size: 12px; }
.retry:hover { border-color: var(--color-border-hover); }
.retry:disabled { opacity: 0.55; cursor: not-allowed; }

.composer { display: grid; grid-template-columns: 1fr auto; gap: 10px; padding: 16px 22px; }
.input { width: 100%; padding: 12px 12px; border-radius: 12px; border: 1px solid var(--color-border); background: var(--color-background); color: var(--color-text); outline: none; transition: border-color 0.15s ease, transform 0.15s ease; }
.input:focus { border-color: var(--color-border-hover); transform: translateY(-1px); }

.btn { padding: 12px 14px; border-radius: 12px; border: 1px solid var(--color-border); background: var(--accent); color: var(--accent-contrast); cursor: pointer; font-weight: 900; transition: transform 0.15s ease, opacity 0.15s ease; }
.btn:hover { transform: translateY(-1px); }
.btn:active { transform: translateY(0); opacity: 0.92; }

.filters { display: flex; flex-wrap: wrap; gap: 10px; padding: 0 22px 14px; }
.chip { border: 1px solid var(--color-border); background: transparent; color: var(--color-text); padding: 8px 10px; border-radius: 999px; cursor: pointer; font-size: 13px; display: inline-flex; align-items: center; gap: 8px; transition: border-color 0.15s ease, transform 0.15s ease, background 0.15s ease; }
.chip:hover { border-color: var(--color-border-hover); transform: translateY(-1px); }
.chip.active { background: var(--color-background); border-color: rgba(66, 184, 131, 0.28); }
.chip:disabled { opacity: 0.5; cursor: not-allowed; }
.chipCount { border: 1px solid var(--color-border); background: var(--color-background); padding: 2px 8px; border-radius: 999px; font-size: 12px; opacity: 0.9; }
.chip.danger { margin-left: auto; }

.list { padding: 6px 10px 10px; }
.ul { list-style: none; display: grid; gap: 10px; padding: 0 12px 12px; margin: 0; }

.item { display: grid; grid-template-columns: auto 1fr auto; gap: 12px; align-items: center; padding: 12px 12px; border-radius: 14px; border: 1px solid var(--color-border); background: var(--color-background); transition: transform 0.15s ease, border-color 0.15s ease; }
.item:hover { transform: translateY(-1px); border-color: var(--color-border-hover); }

.check { border: 0; background: transparent; cursor: pointer; padding: 0; }
.box { width: 22px; height: 22px; border-radius: 7px; border: 1px solid var(--color-border); background: var(--color-background-soft); display: inline-block; position: relative; transition: transform 0.12s ease, background 0.15s ease, border-color 0.15s ease; }
.item:active .box { transform: scale(0.96); }
.item.done .box { border-color: var(--color-border-hover); background: rgba(66, 184, 131, 0.18); }
.item.done .box::after { content: "✓"; position: absolute; inset: 0; display: grid; place-items: center; font-size: 14px; font-weight: 900; color: var(--color-text); animation: pop 0.16s ease; }
@keyframes pop { from { transform: scale(0.75); opacity: 0.6; } to { transform: scale(1); opacity: 1; } }

.content { min-width: 0; cursor: text; }
.text { font-weight: 800; color: var(--color-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.item.done .text { text-decoration: line-through; opacity: 0.65; }
.meta { margin-top: 2px; font-size: 12px; opacity: 0.75; color: var(--color-text); }

.editInput { width: 100%; padding: 10px 10px; border-radius: 12px; border: 1px solid var(--color-border); background: var(--color-background); color: var(--color-text); outline: none; }
.editInput:focus { border-color: var(--color-border-hover); }

.iconBtn { border: 1px solid var(--color-border); background: transparent; color: var(--color-text); width: 38px; height: 38px; border-radius: 12px; cursor: pointer; transition: transform 0.15s ease, border-color 0.15s ease; }
.iconBtn:hover { transform: translateY(-1px); border-color: var(--color-border-hover); }

.empty { padding: 16px 12px 20px; text-align: center; color: var(--color-text); opacity: 0.75; }

.footer { display: flex; justify-content: space-between; gap: 10px; padding: 14px 22px 18px; border-top: 1px solid var(--color-border); background: var(--color-background-soft); }
.muted { font-size: 12px; color: var(--color-text); opacity: 0.75; }

.toast {
  position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%);
  display: flex; gap: 10px; align-items: center;
  padding: 12px 14px; border-radius: 14px; border: 1px solid var(--color-border);
  background: var(--color-background); box-shadow: var(--shadow, 0 18px 45px rgba(0, 0, 0, 0.12));
  max-width: min(720px, 92vw); z-index: 50;
}
.toastText { color: var(--color-text); opacity: 0.92; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.toastBtn { padding: 8px 10px; border-radius: 12px; border: 1px solid var(--color-border); background: var(--accent); color: var(--accent-contrast); cursor: pointer; font-weight: 900; font-size: 12px; }
.toastBtn.ghost { background: transparent; color: var(--color-text); }
.toastBtn:hover { border-color: var(--color-border-hover); }
.toastBtn:disabled { opacity: 0.55; cursor: not-allowed; }

.srOnly { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }

.fade-enter-active, .fade-leave-active { transition: all 0.18s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; transform: translateY(6px); }
</style>
