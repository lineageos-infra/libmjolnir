// @ts-check
import js from '@eslint/js'
import skipFormatting from '@vue/eslint-config-prettier/skip-formatting'
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript'
import pluginVue from 'eslint-plugin-vue'
import tseslint from 'typescript-eslint'

export default defineConfigWithVueTs(
  {
    extends: [
      js.configs.recommended,
      tseslint.configs.recommendedTypeChecked,
      pluginVue.configs['flat/recommended'],
      vueTsConfigs.recommendedTypeChecked,
      skipFormatting
    ],
    rules: {
      eqeqeq: 'error'
    }
  },
  {
    ignores: ['dist/**', 'coverage/**', 'example/dist/**']
  }
)
