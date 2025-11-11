<script setup lang="ts">
import TodoList from './components/TodoList.vue'
</script>

<template>
  <main>
    <TodoList />
  </main>
</template>

<style scoped>
main {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
  background-color: #f9f9f9;
}
</style>
