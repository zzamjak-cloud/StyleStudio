// pdf.js 워커 모듈은 타입 선언을 제공하지 않는다 — documents.ts 가 번들에 넣어 같은 스레드에서 쓴다
declare module 'pdfjs-dist/legacy/build/pdf.worker.mjs';
