<script setup lang="ts">
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from "vue";

type Filter = "all" | "active" | "done";
type BackendStatus = "loading" | "ok" | "error";

type Task = {
  id: number;
  title: string;
  done: boolean;
  createdAt: number;
};

const STORAGE_KEY = "taskbuddy_tasks_v2";
const BACKEND_URL = "https://taskbuddy2-v8fn.onrender.com/TaskBuddy";

// ===== State =====
const tasks = ref<Task[]>([
  { id: 1, title: "Vue-Projekt starten", done: false, createdAt: Date.now() - 86400000 },
  { id: 2, title: "Erste Komponente bauen", done: true, createdAt: Date.now() - 3600000 },
]);

const newTask = ref("");
const filter = ref<Filter>("all");

// Backend badge
const backendStatus = ref<BackendStatus>("loading");
const backendMessage = ref<string>("");

// Inline edit
const editingId = ref<number | null>(null);
const editValue = ref("");
const editInputRef = ref<HTMLInputElement | null>(null);

// Undo toast
const toastOpen = ref(false);
const toastMessage = ref("");
let undoTimer: number | null = null;
let lastDeleted: { task: Task; index: number } | null = null;

const canUndo = computed(() => lastDeleted !== null);

// ===== Helpers =====
function uid() {
  return Date.now() + Math.floor(Math.random() * 1000);
}

/** Safe parse without `any` (fixes ESLint no-explicit-any) */
function safeParseTasks(raw: string | null): Task[] | null {
  if (!raw) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;

    const cleaned: Task[] = [];

    for (const item of parsed) {
      if (typeof item !== "object" || item === null) continue;
      const obj = item as Record<string, unknown>;

      if (typeof obj.id !== "number") continue;
      if (typeof obj.title !== "string") continue;

      cleaned.push({
        id: obj.id,
        title: obj.title,
        done: typeof obj.done === "boolean" ? obj.done : false,
        createdAt: typeof obj.createdAt === "number" ? obj.createdAt : Date.now(),
      });
    }

    return cleaned;
  } catch {
    return null;
  }
}

function loadTasks() {
  const loaded = safeParseTasks(localStorage.getItem(STORAGE_KEY));
  if (loaded && loaded.length > 0) tasks.value = loaded;
}

function saveTasks() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks.value));
}

function formatDate(ts: number) {
  return new Date(ts).toLocaleDateString();
}

function closeToast() {
  toastOpen.value = false;
  toastMessage.value = "";
  if (undoTimer) {
    window.clearTimeout(undoTimer);
    undoTimer = null;
  }
  lastDeleted = null;
}

function showToast(msg: string) {
  toastOpen.value = true;
  toastMessage.value = msg;

  if (undoTimer) window.clearTimeout(undoTimer);
  undoTimer = window.setTimeout(() => closeToast(), 5500);
}

// ===== CRUD =====
function addTask() {
  const title = newTask.value.trim();
  if (!title) return;

  tasks.value.unshift({
    id: uid(),
    title,
    done: false,
    createdAt: Date.now(),
  });

  newTask.value = "";
}

function toggleDone(id: number) {
  const t = tasks.value.find((x) => x.id === id);
  if (t) t.done = !t.done;
}

/** Fixes TS2322 + 'removed possibly undefined' */
function deleteTask(id: number) {
  const idx = tasks.value.findIndex((t) => t.id === id);
  if (idx === -1) return;

  const removedArr = tasks.value.splice(idx, 1);
  const removed = removedArr[0];
  if (!removed) return;

  lastDeleted = { task: removed, index: idx };
  showToast(`Task gelöscht: “${removed.title}”`);
}

function undoDelete() {
  if (!lastDeleted) return;
  tasks.value.splice(lastDeleted.index, 0, lastDeleted.task);
  closeToast();
}

function clearCompleted() {
  const had = tasks.value.some((t) => t.done);
  if (!had) return;
  tasks.value = tasks.value.filter((t) => !t.done);
  showToast("Erledigte Tasks entfernt");
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

function commitEdit(task: Task) {
  const nextTitle = editValue.value.trim();
  if (!nextTitle) {
    cancelEdit();
    return;
  }

  task.title = nextTitle;
  cancelEdit();
}

// ===== Backend =====
async function fetchBackend() {
  backendStatus.value = "loading";
  backendMessage.value = "";

  try {
    const controller = new AbortController();
    const t = window.setTimeout(() => controller.abort(), 8000);

    const res = await fetch(BACKEND_URL, { method: "GET", signal: controller.signal });
    window.clearTimeout(t);

    if (!res.ok) {
      backendStatus.value = "error";
      backendMessage.value = `Offline (HTTP ${res.status})`;
      return;
    }

    const text = await res.text();
    backendStatus.value = "ok";
    backendMessage.value = (text || "Online").trim();
  } catch {
    backendStatus.value = "error";
    backendMessage.value = "Offline";
  }
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

// ===== Lifecycle =====
onMounted(() => {
  loadTasks();
  fetchBackend();
});

watch(tasks, () => saveTasks(), { deep: true });

// ESC closes toast + cancels edit
function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") {
    if (editingId.value !== null) cancelEdit();
    else if (toastOpen.value) closeToast();
  }
}
window.addEventListener("keydown", onKeydown);

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
  if (undoTimer) window.clearTimeout(undoTimer);
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

        <!-- Smart Backend Badge -->
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

          <button class="retry" type="button" @click="fetchBackend" :disabled="backendStatus === 'loading'">
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

        <p v-if="filteredTasks.length === 0" class="empty">
          {{ emptyText }}
        </p>
      </div>

      <footer class="footer">
        <span class="muted">{{ remaining }} offen • {{ completed }} erledigt</span>
        <span class="muted">Doppelklick zum Bearbeiten</span>
      </footer>
    </div>

    <!-- Undo Toast -->
    <div v-if="toastOpen" class="toast" role="status" aria-live="polite">
      <span class="toastText">{{ toastMessage }}</span>
      <button class="toastBtn" type="button" @click="undoDelete" :disabled="!canUndo">Undo</button>
      <button class="toastBtn ghost" type="button" @click="closeToast">Close</button>
    </div>
  </section>
</template>

<style scoped>
/* Dein CSS bleibt 1:1 gleich – du kannst deinen bestehenden Styleblock 그대로 lassen */
</style>
