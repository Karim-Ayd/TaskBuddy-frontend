import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";

type Task = {
  id: number;
  title: string;
  done: boolean;
  createdAt: number;
};

type MockServer = {
  tasks: Task[];
  pingText: string; // "__FAIL__" => Ping 500
};

function makeTask(p: Partial<Task> & Pick<Task, "id" | "title">): Task {
  return {
    id: p.id,
    title: p.title,
    done: p.done ?? false,
    createdAt: p.createdAt ?? Date.now(),
  };
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function textResponse(text: string, status = 200) {
  return new Response(text, {
    status,
    headers: { "Content-Type": "text/plain" },
  });
}

async function flushUi() {
  for (let i = 0; i < 15; i++) {
    await Promise.resolve();
    await nextTick();
  }
}

async function waitFor(predicate: () => boolean, tries = 80) {
  for (let i = 0; i < tries; i++) {
    await flushUi();
    if (predicate()) return;
  }
  throw new Error("Timed out waiting for condition");
}

function getRenderedTitles(wrapper: ReturnType<typeof mount>): string[] {
  // deine Task-Texte sind <p class="text">
  return wrapper.findAll("p.text").map((w) => w.text());
}

function createMockFetch(server: MockServer) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method ?? "GET").toUpperCase();

    // Ping
    if (url.includes("/TaskBuddy")) {
      if (server.pingText === "__FAIL__") return textResponse("fail", 500);
      return textResponse(server.pingText, 200);
    }

    // /api/todos
    if (url.includes("/api/todos") && !/\/api\/todos\/\d+/.test(url)) {
      if (method === "GET") return jsonResponse(server.tasks, 200);

      if (method === "POST") {
        const bodyRaw = init?.body ? String(init.body) : "{}";
        const parsed: unknown = JSON.parse(bodyRaw);
        const body =
          typeof parsed === "object" && parsed !== null
            ? (parsed as Record<string, unknown>)
            : {};

        const title = typeof body.title === "string" ? body.title : "";
        const done = typeof body.done === "boolean" ? body.done : false;
        const createdAt = typeof body.createdAt === "number" ? body.createdAt : Date.now();

        const nextId =
          server.tasks.length === 0 ? 1 : Math.max(...server.tasks.map((t) => t.id)) + 1;

        const saved: Task = makeTask({ id: nextId, title, done, createdAt });
        server.tasks.unshift(saved);
        return jsonResponse(saved, 201);
      }
    }

    // /api/todos/:id
    const m = url.match(/\/api\/todos\/(\d+)/);
    if (m) {
      const id = Number(m[1]);
      const idx = server.tasks.findIndex((t) => t.id === id);

      if (method === "PUT") {
        if (idx === -1) return jsonResponse({ message: "not found" }, 404);
        const existing = server.tasks[idx];
        if (!existing) return jsonResponse({ message: "not found" }, 404);

        const bodyRaw = init?.body ? String(init.body) : "{}";
        const parsed: unknown = JSON.parse(bodyRaw);
        const body =
          typeof parsed === "object" && parsed !== null
            ? (parsed as Record<string, unknown>)
            : {};

        const newTitle = typeof body.title === "string" ? body.title : existing.title;
        const newDone = typeof body.done === "boolean" ? body.done : existing.done;

        const updated: Task = { ...existing, title: newTitle, done: newDone };
        server.tasks[idx] = updated;
        return jsonResponse(updated, 200);
      }

      if (method === "DELETE") {
        if (idx === -1) return jsonResponse({ message: "not found" }, 404);
        server.tasks.splice(idx, 1);
        return new Response(null, { status: 204 });
      }
    }

    return jsonResponse({ message: "not handled", url, method }, 500);
  });
}

async function mountTodo() {
  const mod = await import("../ToDoList.vue");
  return mount(mod.default);
}

describe("ToDoList.vue (10 Tests, stabil, ohne any)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("1) lädt Todos beim Mount und rendert Titel", async () => {
    const server: MockServer = {
      tasks: [
        makeTask({ id: 1, title: "TASK_AAA", done: false, createdAt: 111 }),
        makeTask({ id: 2, title: "TASK_BBB", done: true, createdAt: 222 }),
      ],
      pingText: "OK",
    };

    globalThis.fetch = createMockFetch(server) as unknown as typeof fetch;

    const wrapper = await mountTodo();
    await waitFor(() => {
      const titles = getRenderedTitles(wrapper);
      return titles.includes("TASK_AAA") && titles.includes("TASK_BBB");
    });

    const titles = getRenderedTitles(wrapper);
    expect(titles).toContain("TASK_AAA");
    expect(titles).toContain("TASK_BBB");
  });

  it("2) Remaining zählt nur offene Tasks", async () => {
    const server: MockServer = {
      tasks: [
        makeTask({ id: 1, title: "OPEN_ONE_123", done: false }),
        makeTask({ id: 2, title: "DONE_ONE_123", done: true }),
      ],
      pingText: "OK",
    };

    globalThis.fetch = createMockFetch(server) as unknown as typeof fetch;

    const wrapper = await mountTodo();
    await waitFor(() => getRenderedTitles(wrapper).includes("OPEN_ONE_123"));

    expect(wrapper.text()).toContain("1 offen");
  });

  it("3) Add: POST erstellt Task und erscheint in Liste", async () => {
    const server: MockServer = {
      tasks: [makeTask({ id: 1, title: "EXISTING_999", done: false, createdAt: 1 })],
      pingText: "OK",
    };

    globalThis.fetch = createMockFetch(server) as unknown as typeof fetch;

    const wrapper = await mountTodo();
    await waitFor(() => getRenderedTitles(wrapper).includes("EXISTING_999"));

    await wrapper.get("input#newTask").setValue("NEW_TASK_777");
    await wrapper.get("button.btn").trigger("click");

    await waitFor(() => getRenderedTitles(wrapper).includes("NEW_TASK_777"));

    expect(getRenderedTitles(wrapper)).toContain("NEW_TASK_777");
    expect(server.tasks.some((t) => t.title === "NEW_TASK_777")).toBe(true);
  });

  it("4) Toggle done: klick sendet PUT und toggelt done", async () => {
    const server: MockServer = {
      tasks: [makeTask({ id: 10, title: "TOGGLE_ME_1", done: false, createdAt: 1 })],
      pingText: "OK",
    };

    const mockFetch = createMockFetch(server);
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const wrapper = await mountTodo();
    await waitFor(() => getRenderedTitles(wrapper).includes("TOGGLE_ME_1"));

    await waitFor(() => wrapper.find("button.check").exists());
    await wrapper.get("button.check").trigger("click");

    await waitFor(() => (server.tasks.find((t) => t.id === 10)?.done ?? false) === true);

    const calls = mockFetch.mock.calls.map((c) => String(c[0]));
    expect(calls.some((u) => u.includes("/api/todos/10"))).toBe(true);
  });

  it("5) Delete + Undo: Task kommt zurück und Backend löscht nicht", async () => {
    vi.useFakeTimers();

    const server: MockServer = {
      tasks: [makeTask({ id: 7, title: "DEL_ME_777", done: false, createdAt: 1 })],
      pingText: "OK",
    };

    globalThis.fetch = createMockFetch(server) as unknown as typeof fetch;

    const wrapper = await mountTodo();
    await waitFor(() => getRenderedTitles(wrapper).includes("DEL_ME_777"));

    await wrapper.get("button.iconBtn").trigger("click");
    await waitFor(() => wrapper.text().includes("Task gelöscht"));

    await waitFor(() => wrapper.find("button.toastBtn").exists());
    await wrapper.get("button.toastBtn").trigger("click");

    await waitFor(() => getRenderedTitles(wrapper).includes("DEL_ME_777"));

    await vi.advanceTimersByTimeAsync(5200);
    await flushUi();

    expect(server.tasks.some((t) => t.id === 7)).toBe(true);
  });

  it("6) Delete ohne Undo: nach 5s Backend DELETE", async () => {
    vi.useFakeTimers();

    const server: MockServer = {
      tasks: [makeTask({ id: 8, title: "DEL2_888", done: false, createdAt: 1 })],
      pingText: "OK",
    };

    const mockFetch = createMockFetch(server);
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const wrapper = await mountTodo();
    await waitFor(() => getRenderedTitles(wrapper).includes("DEL2_888"));

    await wrapper.get("button.iconBtn").trigger("click");
    await waitFor(() => wrapper.text().includes("Task gelöscht"));

    await vi.advanceTimersByTimeAsync(5200);
    await flushUi();

    expect(server.tasks.some((t) => t.id === 8)).toBe(false);

    const deletes = mockFetch.mock.calls.filter((c) => (c[1]?.method ?? "GET") === "DELETE");
    expect(deletes.some((c) => String(c[0]).includes("/api/todos/8"))).toBe(true);
  });

  it("7) Clear done: entfernt done Tasks und macht DELETE pro done", async () => {
    const server: MockServer = {
      tasks: [
        makeTask({ id: 1, title: "DONE_ONE_ABC", done: true, createdAt: 1 }),
        makeTask({ id: 2, title: "OPEN_ONE_ABC", done: false, createdAt: 2 }),
        makeTask({ id: 3, title: "DONE_TWO_ABC", done: true, createdAt: 3 }),
      ],
      pingText: "OK",
    };

    const mockFetch = createMockFetch(server);
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const wrapper = await mountTodo();
    await waitFor(() => getRenderedTitles(wrapper).includes("OPEN_ONE_ABC"));

    await wrapper.get("button.chip.danger").trigger("click");

    await waitFor(() => {
      const titles = getRenderedTitles(wrapper);
      return titles.length === 1 && titles[0] === "OPEN_ONE_ABC";
    });

    expect(server.tasks.map((t) => t.id)).toEqual([2]);

    const deletes = mockFetch.mock.calls.filter((c) => (c[1]?.method ?? "GET") === "DELETE");
    expect(deletes.some((c) => String(c[0]).includes("/api/todos/1"))).toBe(true);
    expect(deletes.some((c) => String(c[0]).includes("/api/todos/3"))).toBe(true);
  });

  it("8) Backend Badge OK zeigt Ping-Text", async () => {
    const server: MockServer = { tasks: [], pingText: "M1, M2, M3" };
    globalThis.fetch = createMockFetch(server) as unknown as typeof fetch;

    const wrapper = await mountTodo();
    await waitFor(() => wrapper.text().includes("M1, M2, M3"));

    expect(wrapper.text()).toContain("M1, M2, M3");
  });

  it("9) Backend Badge Error zeigt Offline bei Ping 500", async () => {
    const server: MockServer = { tasks: [], pingText: "__FAIL__" };
    globalThis.fetch = createMockFetch(server) as unknown as typeof fetch;

    const wrapper = await mountTodo();
    await waitFor(() => wrapper.text().includes("Offline"));

    expect(wrapper.text()).toContain("Offline");
  });

  it("10) Cache Fallback: wenn GET failt, lädt aus localStorage", async () => {
    const cached: Task[] = [makeTask({ id: 99, title: "FROM_CACHE_999", done: false, createdAt: 1 })];
    localStorage.setItem("taskbuddy_tasks_cache_v1", JSON.stringify(cached));

    const failingFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/todos")) return jsonResponse({ message: "fail" }, 500);
      if (url.includes("/TaskBuddy")) return textResponse("OK", 200);
      return jsonResponse({ message: "not handled" }, 500);
    });

    globalThis.fetch = failingFetch as unknown as typeof fetch;

    const wrapper = await mountTodo();

    await waitFor(() => getRenderedTitles(wrapper).includes("FROM_CACHE_999"));
    expect(getRenderedTitles(wrapper)).toContain("FROM_CACHE_999");
    expect(wrapper.text()).toContain("Backend nicht erreichbar");
  });
});
