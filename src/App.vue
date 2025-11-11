<script setup lang="ts">
import ToDoList from './components/ToDoList.vue'
</script>

<template>
  <main>
    <ToDoList />
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
