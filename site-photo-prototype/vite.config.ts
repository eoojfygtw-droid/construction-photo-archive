// Vite 設定檔:React plugin + 相對路徑輸出(方便直接開啟 build 結果)
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
});
