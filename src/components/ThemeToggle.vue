<script setup lang="ts">
import { ref, onMounted } from "vue";
import { initTheme, setTheme, type Theme } from "../theme";

const theme = ref<Theme>("light");

onMounted(() => {
  theme.value = initTheme();
});

function toggle() {
  const next: Theme = theme.value === "dark" ? "light" : "dark";
  theme.value = next;
  setTheme(next);
}
</script>

<template>
  <button class="theme-btn" @click="toggle" aria-label="toggle theme">
    {{ theme === "dark" ? "🌙 Dark" : "☀️ Light" }}
  </button>
</template>

<style scoped>
.theme-btn {
  padding: 8px 12px;
  border-radius: 10px;
  border: 1px solid var(--color-border);
  background: var(--color-background-soft);
  color: var(--color-text);
  cursor: pointer;
}
.theme-btn:hover {
  border-color: var(--color-border-hover);
}
</style>
