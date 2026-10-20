// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  ssr: false,
  compatibilityDate: '2025-07-15',
  devtools: { enabled: false },
  future: {
    compatibilityVersion: 3,
  },
  devServer: {
    port: 8100
  },
  app: {
    head: { title: 'THE LAST BATTALION' },
  },
  modules: ['@pinia/nuxt'],
})
