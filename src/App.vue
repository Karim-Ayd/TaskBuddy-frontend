<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router'
import TodoList from './components/TodoList.vue'
</script>

<template>
  <header>
    <img alt="Vue logo" class="logo" src="@/assets/logo.svg" width="100" height="100" />

    <div class="wrapper">
      <TodoList />

      <nav>
        <RouterLink to="/">Home</RouterLink>
        <RouterLink to="/about">About</RouterLink>
      </nav>
    </div>
  </header>

  <RouterView />
</template>

<style scoped>
/* dein bestehendes CSS kannst du behalten */
</style>
