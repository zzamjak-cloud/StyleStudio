/*
 * StyleStudio - AI 게임 아트 제작 데스크톱 애플리케이션
 * Copyright (C) 2026 최진평 (Jinpyoung Choi)
 *
 * 이 프로그램은 자유 소프트웨어입니다. GNU 일반 공중 사용 허가서 제3판
 * 또는 그 이후 판의 조건에 따라 재배포하거나 수정할 수 있습니다.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

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
