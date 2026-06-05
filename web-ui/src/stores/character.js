import { defineStore } from 'pinia'
import { ref } from 'vue'
import * as api from '../api/index.js'

export const useCharacterStore = defineStore('character', () => {
  const characters = ref([])

  async function loadCharacters() {
    try {
      const data = await api.listCharacters()
      characters.value = data.characters || []
    } catch (e) {
      console.error('loadCharacters:', e)
    }
  }

  async function create(data) {
    const result = await api.createCharacter(data)
    await loadCharacters()
    return result
  }

  async function update(id, data) {
    await api.updateCharacter(id, data)
    await loadCharacters()
  }

  return { characters, loadCharacters, create, update }
})
