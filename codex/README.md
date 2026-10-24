# Codex Jev kit

Python 3.11+와 Codex CLI가 필요하다 (Python 3.9/3.10은 `pip install tomli` 필요). Claude 패키지는 그대로 두고 공통 Jev
엔진을 복사해 독립적인 Codex 플러그인과 마켓플레이스를 생성한다.

```bash
python3 codex/scripts/build.py
codex plugin marketplace add ./codex/dist
codex plugin add jev-kit@codex-jev-collection
python3 codex/dist/plugins/jev-kit/scripts/setup.py
python3 codex/dist/plugins/jev-kit/scripts/setup.py --apply
python3 codex/dist/plugins/jev-kit/scripts/jev.py preflight --all --json
```

에이전트 설치 후 Codex를 재시작하고 `$jev-orchestrator`로 호출한다.
설치된 플러그인의 setup 스킬로도 에이전트를 설치할 수 있다. 플러그인 훅은
Codex에서 검토하고 신뢰해야 실행된다. `config.toml`, 승인 설정, 상태줄,
전역 `AGENTS.md`는 설치 스크립트가 수정하지 않는다. `--force`는 충돌한
에이전트를 `~/.codex/jev/backup/`에 백업한 뒤 교체한다.

모델 기본값은 architect/debugger에 `gpt-6-astra`, 나머지에 `gpt-6.1-sol`이다.
계정에서 지원하는 모델에 맞춰 빌드 결과의 `config/agents.json`과
`agents/*.toml`을 함께 변경한다. architect는 xhigh, 다른 역할은 원본의
low/medium/high 추론 강도를 유지한다. 읽기 역할은 read-only 샌드박스,
구현 역할은 workspace-write 샌드박스를 사용한다.

## 지원 범위

- Jev API 라우팅, 중복 작업 감지, 계획 저장, 실패별 승격, 컨텍스트 팩,
  handoff 검증과 보고 도구를 재사용한다. API 키는 `TYPESAFE_API_KEY` 또는
  `~/.config/typesafe/.env`에서 읽으며, 라우팅 요청은 TypeSafe로 전송된다.
- Codex용 TOML 에이전트 9개, preflight, dispatch 검증, 결정적 permission
  규칙, 인자에 포함된 자격증명 검사, 프롬프트 안내 훅을 제공한다.
- Context7 사용 스킬도 포함한다. 실제 Context7 MCP 연결은 별도로 설정한다.
- Codex는 훅의 `ask` 결정을 지원하지 않으므로 위험 규칙은 deny로 반환한다.
  자동 승인은 구현하지 않는다. 훅 오류/미신뢰/미지원 도구 경로는 보호를
  우회할 수 있으므로 실제 권한 경계는 Codex 샌드박스와 승인 정책이다.
- graphify/graphq는 선택 사항이며 미설치 시 대상 파일 목록으로 fallback한다.
  브라우저 QA 실행기는 함께 패키징하지만 jev-ultrafast/uv/브라우저 설치는
  별도다. read-only QA 에이전트 대신 부모가 시나리오와 결과를 생성한다.
- Claude transcript에 의존하는 `outcomes`는 비활성화했다.
- 외부 의존 플러그인 8개는 아래의 별도 준비·설치 명령으로 선택한다.
  skillpick과 Claude 공식 플러그인은 포함하지 않는다.

## 외부 의존성 선택 설치

`dependencies.json`의 고정 버전을 기존 `~/.claude/plugins/cache`에서 읽는다.
원본 캐시는 수정하지 않는다. 캐시가 없으면 `--fetch`로 고정 커밋을 내려받거나
`--source NAME=/absolute/path`로 같은 버전의 소스를 지정한다.
어댑터와 upstream native 훅에는 Node.js 22 이상을 사용한다. TypeScript 빌드에는 npm도 필요하며, 소스에 TypeScript가 없으면
임시 패키지에서 `npm ci --ignore-scripts`를 실행한다.

```bash
python3 codex/scripts/dependencies.py list
python3 codex/scripts/dependencies.py prepare --all --build-runtime
python3 codex/scripts/dependencies.py install --all
python3 codex/scripts/dependencies.py install --all --apply
```

`install`은 기본적으로 실행할 명령만 출력한다. `--apply`가 실제 설치한다.
`--all` 대신 `--only router --only jev-rules`처럼 선택할 수 있다.
`fast-jev-output`은 Codex 이름인 `jev-pruner`로도 선택할 수 있다.
기존 jev-kit 빌드는 의존성을 자동 준비하지 않으므로, 함께 설치하려면
`build.py`를 먼저 실행하고 의존성을 준비한다.

| 원본 이름 | Codex 이름 | 동작 범위 |
|---|---|---|
| typesafe | typesafe | 원본 스킬, API 자격증명 필요 |
| router | router | 명시적 분류·추천, 대화 모델 자동 전환 없음 |
| jev-belay | jev-belay | Codex 훅 증거로 완료 검증, transcript 수정 없음 |
| fast-jev-output | jev-pruner | 원본 Codex 래퍼와 도구 이름 정규화 훅으로 선택한 비대화형 출력 축약 |
| fast-jev-compaction | fast-jev-compaction | 내보낸 메시지 파일 축약, 현재 대화 변경 없음 |
| jev-rules | jev-rules | `.codex/jev-rules` 선택·주입, Claude UI 제외 |
| jev-guard | jev-guard | 원본 Codex 훅, 자격증명과 훅 신뢰 필요 |
| andrej-karpathy-skills | andrej-karpathy-skills | 원본 가이드라인 스킬 |

각 패키지의 `PROVENANCE.json`에 원본 버전·커밋·이식 방식이 기록된다.
Claude 캐시는 매니페스트 버전을 검증하며 Git 커밋 일치까지 증명하지는 않는다.
레지스트리의 `commit`은 다운로드용 기준이고, 실제 검증한 커밋은
`verified_commit`에 별도로 기록한다.
Git 소스는 HEAD와 `git_dirty`도 기록하며, 커밋 ID만으로 파일 내용의 무변경을 보장하지 않는다.
자동 compaction, 모든 셸 출력 필터링, 외부 모델 재라우팅의 동등 동작을
보장하지 않는다. 훅 실행 여부와 관계없이 Codex 권한 정책이 우선한다.

### Router UI

Router 추천 기본 모델은 `micro`·`low`에 `gpt-6-luna`, `medium`·`high`에
`gpt-6.1-sol`이다. Router 모델 추천에서 `gpt-6-astra`는 제외한다.
이 매핑은 Jev 실행 에이전트의 고정 모델 정의와 별도로 관리된다.

Router `1.14.0-codex.5`는 MCP Apps 패널을 제공한다. 렌더 도구의 설명과 성공
응답 모두에 UI 리소스 메타데이터를 제공하여, 도구 설명 메타데이터가 전달되지
않는 경우에도 내장 렌더러가 패널을 찾을 수 있게 한다. 도구 래퍼는 응답의
`_meta`와 `structuredContent`를 포함한 전체 envelope를 유지해야 한다.
새 대화 또는 대화 초기화의
첫 응답에서 `show_router`를 한 번 호출하도록 SessionStart 훅이 안내한다.
재개·compaction·서브에이전트에는 적용하지 않는다. 훅 정의가 바뀌면 Codex의
훅 신뢰 검토가 필요할 수 있다. 실제 패널 표시는 호스트 지원과 첫 모델 응답에
따라 이루어지며, 훅 자체가 UI를 렌더링하지는 않는다. 설치 후 Codex를 다시
열고 `$router:router` 또는 “Router UI 열어 줘”를 입력하면 `show_router`가
작업 분류, 난이도별 모델·추론 강도·역할 설정, 최근 결과를 표시한다.
현재 모델을 자동으로 변경하지 않으며, 원래 Claude 터미널 상주 패널과는 다르다.

MCP Apps를 렌더링하지 않는 호스트에서는 다음 명령이 출력하는 로컬 주소를 연다.

```bash
node codex/dist/plugins/router/scripts/preview.mjs
```

미리보기는 loopback에서만 실행되며 같은 분류·설정 서비스를 사용한다.
분류 작업은 TypeSafe로 전송된다. 설정은 `CODEX_HOME/jev/router/config.json`
(기본 `~/.codex/jev/router/config.json`, `PLUGIN_DATA` 지정 시 그 아래 router)에
저장한다. 최근 30건에는 시각·난이도·모델·추론 강도만 보관한다.
작업 원문과 API 키는 저장하지 않는다. CLI도 저장된 매핑을 사용한다.

GUI에서 실행한 Router에 키가 상속되지 않으면 MCP 실행기가 interactive login
zsh/bash에서 `TYPESAFE_API_KEY`와 `JEV_API_KEY`만 가져온다. 이미 상속된 키와
기존 TypeSafe 설정 파일을 우선하며, 셸 초기화는 5초·출력 64KiB로 제한한다.
셸의 시작 출력과 오류는 MCP 출력으로 전달하지 않고, 키를 별도 파일에 저장하지
않는다. 셸이 지원되지 않거나 초기화에 실패하면 기존 키 미설정 안내를 유지한다.

검증:

```bash
python3 -m unittest discover -s codex/tests -v
node --test codex/tests/adapters.test.mjs
```

Node 어댑터 테스트는 먼저 `prepare --all --build-runtime`으로 생성한 패키지를
사용하며, API 호출은 모의 응답으로 검증한다. `JEV_TEST_DIST`로 별도 빌드
경로를 지정할 수 있다. API 키는 환경변수 또는 기존 TypeSafe 설정에서
실행 시 읽으며 배포 패키지에 복사하지 않는다.

Codex 테스트는 임시 CODEX_HOME에서 실제 CLI 마켓플레이스 등록/설치,
에이전트 설치·충돌·백업, 프로젝트 에이전트 우선순위, dispatch 및 파일 보호,
계획·handoff·ledger를 검증한다. CLI가 없으면 설치 통합 테스트만 건너뛴다.
실제 TypeSafe API, 모델 호출, 브라우저 QA까지 실행하는 테스트는 아니다.
공통 엔진 테스트의 로컬 HTTP 서버 검증은 포트 바인딩 권한이 필요하다.
기존 Claude prompt/dispatch 훅 테스트는 `~/.claude/jev` 전역 로그와
로스터 캐시에 의존하므로 제한된 샌드박스에서는 일부 실패할 수 있다.

형식 기준: [플러그인](https://developers.openai.com/plugins/build/plugins),
[에이전트](https://learn.chatgpt.com/docs/agent-configuration/subagents),
[훅](https://learn.chatgpt.com/docs/hooks).
