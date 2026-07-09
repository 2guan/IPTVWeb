import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 600,
    rolldownOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/')) {
            return 'react-vendor'
          }
          if (id.includes('/@ant-design/icons/')) {
            return 'antd-icons'
          }
          if (id.includes('/@ant-design/')) {
            const match = id.match(/node_modules\/@ant-design\/([^/]+)/)
            return match ? `antd-${match[1]}` : 'antd-vendor'
          }
          if (id.includes('/@rc-component/')) {
            const match = id.match(/node_modules\/@rc-component\/([^/]+)/)
            return match ? `rc-${match[1]}` : 'rc-vendor'
          }
          if (id.includes('/antd/')) {
            const match = id.match(/node_modules\/antd\/es\/([^/]+)/)
            return match ? `antd-${match[1]}` : 'antd-core'
          }
          const rcMatch = id.match(/node_modules\/(rc-[^/]+)/)
          if (rcMatch) {
            return rcMatch[1]
          }
          if (id.includes('/hls.js/')) {
            return 'player-vendor'
          }
          return 'vendor'
        },
      },
    },
  },
})
