import { configure } from '@testing-library/dom';

// Screen tests wait for real async work (reading Word templates, IndexedDB). On a busy machine running the whole
// suite in parallel this can pass testing-library's default 1 s; allow 5 s so a slow machine doesn't fail them.
configure({ asyncUtilTimeout: 5000 });
