<script setup lang="ts">
import ToDoList from "./components/ToDoList.vue";
import ThemeToggle from "./components/ThemeToggle.vue";
</script>

<template>
  <main>
    <div class="topbar">
      <ThemeToggle />
    </div>

    <ToDoList />
  </main>
</template>

<style scoped>
main {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh;

  /* wichtig für overlays */
  position: relative;
  isolation: isolate;

  /* Premium background: subtle glow + base */
  background:
    radial-gradient(
      800px 500px at 50% 20%,
      color-mix(in srgb, var(--accent) 12%, transparent),
      transparent 60%
    ),
    var(--color-background);
}

/* Vignette overlay */
main::after {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: -1;

  background: radial-gradient(
    1200px 700px at 50% 40%,
    transparent 40%,
    rgba(0, 0, 0, 0.28)
  );
}


main::before {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: -1;
  opacity: 0.08;
  mix-blend-mode: overlay;

  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='180' height='180' filter='url(%23n)' opacity='.35'/%3E%3C/svg%3E");
}

.topbar {
  position: absolute;
  top: 16px;
  right: 16px;
  z-index: 2; /* damit es immer oben bleibt */
}
</style>
