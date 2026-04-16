import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AuthGuard } from "./components/common/AuthGuard";
import "./index.css";
import { listAvailableModels } from "./utils/checkGeminiModels";
import { loadApiKey } from "./lib/storage";

// 전역 함수: 콘솔에서 Gemini 모델 리스트 확인
(window as any).listGeminiModels = async () => {
  try {
    const apiKey = await loadApiKey();
    if (!apiKey) {
      console.error('❌ API 키가 설정되지 않았습니다. 먼저 설정 화면에서 API 키를 입력하세요.');
      return;
    }
    await listAvailableModels(apiKey);
  } catch (error) {
    console.error('❌ 모델 리스트 조회 오류:', error);
  }
};

console.log('💡 팁: 콘솔에서 listGeminiModels()를 실행하여 사용 가능한 모델을 확인하세요.');

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AuthGuard appName="Style Studio">
      <App />
    </AuthGuard>
  </React.StrictMode>,
);
