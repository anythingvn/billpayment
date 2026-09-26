/// <reference types="vite/client" />

// docx-templates' polyfilled browser bundle (Buffer, vm, stream…) has the same API as the Node entry.
declare module 'docx-templates/lib/browser.js' {
  export * from 'docx-templates';
}
