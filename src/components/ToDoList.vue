<script setup lang="ts">
import { ref, onMounted } from 'vue'

// ===== Aufgabenverwaltung =====
const tasks = ref([
  { id: 1, title: 'Vue-Projekt starten', done: false },
  { id: 2, title: 'Erste Komponente bauen', done: true },
])

const newTask = ref('')

function addTask() {
  if (newTask.value.trim() === '') return
  tasks.value.push({
    id: Date.now(),
    title: newTask.value.trim(),
    done: false
  })
  newTask.value = ''
}

function deleteTask(id: number) {
  tasks.value = tasks.value.filter(task => task.id !== id)
}

// ===== Verbindung zum Backend =====
const backendMessage = ref('Lade Nachricht vom Server...')

onMounted(async () => {
  try {
    const response = await fetch('https://taskbuddy2-v8fn.onrender.com/TaskBuddy')
    const text = await response.text()
    console.log('Antwort vom Backend:', text)
    backendMessage.value = text
  } catch (error) {
    console.error('Fehler beim Laden der Backend-Daten:', error)
    backendMessage.value = 'Server nicht erreichbar 😢'
  }
})
</script>

<template>
  <section class="todo">
    <h2>📝 TaskBuddy – Meine Aufgaben</h2>

    <!-- Backend Nachricht -->
    <p class="backend">{{ backendMessage }}</p>

    <!-- Neue Aufgabe hinzufügen -->
    <div class="input-row">
      <input
        v-model="newTask"
        type="text"
        placeholder="Neue Aufgabe eingeben..."
      />
      <button @click="addTask">+</button>
    </div>

    <!-- Aufgabenliste -->
    <ul>
      <li v-for="task in tasks" :key="task.id">
        <label>
          <input type="checkbox" v-model="task.done" />
          <span :class="{ done: task.done }">{{ task.title }}</span>
        </label>
        <button @click="deleteTask(task.id)">🗑</button>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.todo {
  max-width: 420px;
  margin: 2rem auto;
  padding: 1rem;
  border: 1px solid #ddd;
  border-radius: 12px;
  font-family: system-ui, sans-serif;
}
h2 {
  text-align: center;
  margin-bottom: 1rem;
}
.backend {
  text-align: center;
  color: #42b883;
  font-weight: bold;
  margin-bottom: 1rem;
}
.input-row {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1rem;
}
input[type="text"] {
  flex: 1;
  padding: 0.5rem;
  border-radius: 6px;
  border: 1px solid #ccc;
}
button {
  background-color: #42b983;
  color: white;
  border: none;
  border-radius: 6px;
  padding: 0.5rem 0.75rem;
  cursor: pointer;
}
button:hover {
  background-color: #36986e;
}
ul {
  list-style: none;
  padding: 0;
}
li {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.25rem 0;
}
.done {
  text-decoration: line-through;
  color: gray;
}
</style>
