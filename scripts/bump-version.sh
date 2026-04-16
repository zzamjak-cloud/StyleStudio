#!/bin/bash
# StyleStudio 버전 범프 스크립트
# 사용법: ./scripts/bump-version.sh <new-version>
# 예시: ./scripts/bump-version.sh 0.5.0
#
# 수행 작업:
#   1. package.json, tauri.conf.json, Cargo.toml 버전 업데이트
#   2. CHANGELOG.md에 새 버전 섹션 추가 (Unreleased -> 새 버전)
#   3. 변경사항 커밋 및 버전 태그 생성
#   4. (선택) 태그 푸시

set -euo pipefail

# 색상 출력
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 프로젝트 루트 디렉토리로 이동
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"

# 인자 확인
if [ $# -lt 1 ]; then
  echo -e "${RED}오류: 버전 번호를 지정하세요.${NC}"
  echo "사용법: $0 <new-version>"
  echo "예시: $0 0.5.0"
  exit 1
fi

NEW_VERSION="$1"

# 버전 형식 검증 (semver)
if ! [[ "$NEW_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo -e "${RED}오류: 올바른 semver 형식이 아닙니다 (예: 1.2.3)${NC}"
  exit 1
fi

# 현재 버전 확인
CURRENT_VERSION=$(node -p "require('./package.json').version")
echo -e "${YELLOW}현재 버전: ${CURRENT_VERSION}${NC}"
echo -e "${GREEN}새 버전: ${NEW_VERSION}${NC}"
echo ""

# 작업 디렉토리가 깨끗한지 확인
if [ -n "$(git status --porcelain)" ]; then
  echo -e "${RED}오류: 커밋하지 않은 변경사항이 있습니다. 먼저 정리해주세요.${NC}"
  git status --short
  exit 1
fi

# 1. package.json 버전 업데이트
echo -e "${GREEN}[1/5] package.json 업데이트...${NC}"
node -e "
  const fs = require('fs');
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  pkg.version = '${NEW_VERSION}';
  fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
"

# 2. tauri.conf.json 버전 업데이트
echo -e "${GREEN}[2/5] tauri.conf.json 업데이트...${NC}"
node -e "
  const fs = require('fs');
  const conf = JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json', 'utf8'));
  conf.version = '${NEW_VERSION}';
  fs.writeFileSync('src-tauri/tauri.conf.json', JSON.stringify(conf, null, 2) + '\n');
"

# 3. Cargo.toml 버전 업데이트
echo -e "${GREEN}[3/5] Cargo.toml 업데이트...${NC}"
sed -i.bak -E "s/^version = \"[0-9]+\.[0-9]+\.[0-9]+\"/version = \"${NEW_VERSION}\"/" src-tauri/Cargo.toml
rm -f src-tauri/Cargo.toml.bak

# 4. CHANGELOG.md 업데이트 (Unreleased -> 새 버전)
echo -e "${GREEN}[4/5] CHANGELOG.md 업데이트...${NC}"
TODAY=$(date +%Y-%m-%d)

# Unreleased 섹션을 새 버전으로 변환하고 빈 Unreleased 섹션 추가
node -e "
  const fs = require('fs');
  let changelog = fs.readFileSync('CHANGELOG.md', 'utf8');

  // '## [Unreleased]' 바로 아래에 내용이 있으면 새 버전 헤더로 이동
  const unreleasedPattern = /## \[Unreleased\]\n/;
  const newSection = '## [Unreleased]\n\n## [${NEW_VERSION}] - ${TODAY}\n';
  changelog = changelog.replace(unreleasedPattern, newSection);

  fs.writeFileSync('CHANGELOG.md', changelog);
"

# 5. 커밋 및 태그 생성
echo -e "${GREEN}[5/5] 커밋 및 태그 생성...${NC}"
git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml CHANGELOG.md
git commit -m "chore: bump version to v${NEW_VERSION}"
git tag -a "v${NEW_VERSION}" -m "Release v${NEW_VERSION}"

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN} 버전 범프 완료: v${NEW_VERSION}${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "변경된 파일:"
echo "  - package.json"
echo "  - src-tauri/tauri.conf.json"
echo "  - src-tauri/Cargo.toml"
echo "  - CHANGELOG.md"
echo ""
echo -e "${YELLOW}다음 단계:${NC}"
echo "  1. CHANGELOG.md의 [${NEW_VERSION}] 섹션에 변경 내역을 작성하세요."
echo "  2. 작성 완료 후: git add CHANGELOG.md && git commit --amend --no-edit"
echo "  3. 원격에 푸시: git push origin main --tags"
echo ""
echo -e "${YELLOW}또는 CHANGELOG가 이미 작성되어 있다면:${NC}"
echo "  git push origin main --tags"
