# claude-jev-collection

플러그인 `kit@claude-jev-collection` 하나를 설치하면 아래 구성이 함께 들어온다.

## 구성

| 구분 | 내용 | 적용 방식 |
|---|---|---|
| 의존 플러그인 8개 | typesafe, router, jev-belay, fast-jev-output, fast-jev-compaction, jev-rules, jev-guard, andrej-karpathy-skills | `plugin.json`의 `dependencies`로 원래 마켓플레이스에서 자동 설치 |
| 공식 플러그인 3개 | context7, frontend-design, claude-md-management | `/kit:setup`이 없을 때만 설치 |
| 스킬 | `kit:jev-orchestrator`, `kit:context7-mcp`, `kit:setup` | 플러그인 |
| 훅 | permission_gate, prompt_router, dispatch_router (jev-harness), jev-secret-guard, jev-auto-approve | 플러그인 `hooks/hooks.json` |
| skillpick | 프롬프트마다 맞는 스킬을 골라 주는 UserPromptSubmit 훅 (govindup63/skillpick, bun) | 훅은 플러그인의 `hooks/skillpick-hook.sh`. 클론(`~/skillpick`, `SKILLPICK_HOME`로 변경 가능)과 `bun install`은 `/kit:setup`. bun이나 클론이 없으면 훅은 아무것도 하지 않는다 |
| jev 에이전트 9개 | `~/.claude/agents/jev-*.md` | `/kit:setup`이 복사. 플러그인 에이전트로 두면 이름이 `kit:jev-*`로 바뀌어 Jev 라우팅이 깨진다 |
| 상태줄 | `~/.claude/statusline.sh` + `settings.json`의 `statusLine` | `/kit:setup`. 플러그인은 `statusLine`을 설정할 수 없다 |
| 전역 규칙 | `~/.claude/CLAUDE.md`, `~/.claude/rules/*.md` | `/kit:setup` |
| env | `JEV_SECRET_ASK=0.5`, `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` | `/kit:setup` (없는 키만 추가) |

포함하지 않는 것: bun 자체(https://bun.sh), `TYPESAFE_API_KEY`(비밀값. `~/.config/typesafe/.env`나 셸 환경에 직접 둔다. skillpick도 이 환경변수를 먼저 읽는다).

`skillpick doctor`는 Claude 훅을 `settings.json`에서만 찾으므로 kit로 옮긴 뒤에는 "not installed"로 표시된다. 훅은 플러그인에서 정상 실행된다.

## 새 PC에 설치

```bash
git clone <이 저장소> ~/claude-jev-collection   # 또는 디렉터리 복사
~/claude-jev-collection/install.sh
```

`install.sh`는 의존 마켓플레이스 8곳과 이 마켓플레이스를 등록하고, `kit@claude-jev-collection`를 설치한다. 그다음 setup 계획을 보여 주고 확인을 받은 뒤 적용한다.

## 기존 PC를 kit로 옮기기

```bash
claude plugin marketplace add ~/claude-jev-collection
claude plugin install kit@claude-jev-collection
```

새 세션에서 `/kit:setup`을 실행한다. kit가 설치된 상태에서는 `settings.json`에 직접 등록한 같은 훅과 `~/.claude/skills`의 중복 스킬을 정리한다. 그러지 않으면 훅이 두 번 실행된다. 바뀌기 전 파일은 `~/.claude/kit/backup/<시각>/`에 남는다.

## 원본이 바뀌었을 때

jev-harness, 가드 훅, 상태줄, 전역 규칙을 고친 뒤:

```bash
~/claude-jev-collection/sync.sh                     # 원본 → plugins/kit 복사
# plugin.json과 marketplace.json의 version을 올린다
claude plugin marketplace update claude-jev-collection
claude plugin update kit@claude-jev-collection
```

`sync.sh`는 `SKILL.md`와 에이전트의 스킬 경로를 플러그인 경로로 바꿔서 복사한다. 에이전트는 SessionStart 훅이 매 세션 갱신하는 `~/.claude/kit/current` 링크를 쓴다. 플러그인 캐시 경로는 버전마다 바뀌기 때문이다.

## 검증

```bash
claude plugin validate ~/claude-jev-collection
python3 ~/claude-jev-collection/plugins/kit/skills/setup/scripts/kit_setup.py   # 드라이런
```

## 원본 출처

kit 안의 각 구성요소가 어디서 왔는지다. 라이선스는 설치된 플러그인 캐시의 LICENSE 파일을 기준으로 적었고, 확인하지 못한 항목은 '확인 필요'로 뒀다. 원본을 고치면 `sync.sh`로 다시 복사한다. 복사본을 직접 고치지 않는다.

### 의존 플러그인 (설치 시 원본 마켓플레이스에서 받는다)

| 플러그인 | 원본 저장소 | 라이선스 |
|---|---|---|
| typesafe@typesafe-ai | https://github.com/typesafe-ai/skills | MIT |
| router@alexei-led-claude-router | https://github.com/alexei-led/claude-router | MIT |
| jev-belay@jev-belay | https://github.com/valentynkit/jev-belay | MIT |
| fast-jev-output@fast-jev-output | https://github.com/tamaratran/jev-pruner | MIT |
| fast-jev-compaction@fast-jev-compaction | https://github.com/tamaratran/fast-jev-compaction | MIT |
| jev-rules@jev-rules | https://github.com/EliaAlberti/jev-rules | 확인 필요 (설치본에 LICENSE 파일 없음) |
| jev-guard@jev-guard | https://github.com/leepokai/jev-guard | MIT |
| andrej-karpathy-skills@karpathy-skills | https://github.com/forrestchang/andrej-karpathy-skills | 확인 필요 (설치본에 LICENSE 파일 없음) |
| context7@claude-plugins-official | https://github.com/anthropics/claude-plugins-official (`external_plugins/context7`) | 확인 필요 |
| frontend-design@claude-plugins-official | https://github.com/anthropics/claude-plugins-official (`plugins/frontend-design`) | 확인 필요 |
| claude-md-management@claude-plugins-official | https://github.com/anthropics/claude-plugins-official (`plugins/claude-md-management`) | 확인 필요 |

### kit에 복사해 넣은 것

| kit 안의 위치 | 원본 | 복사 시점 | 라이선스 |
|---|---|---|---|
| `plugins/kit/skills/jev-orchestrator/`, `plugins/kit/config/`, `plugins/kit/hooks` 중 jev 훅 3개, `plugins/kit/assets/agents/` | https://github.com/dansya-arsana/jev-harness (`skill/jev-orchestrator`, `config`, `agents`) | 커밋 `75ba6a8` | MIT, © dansya-arsana (`plugins/kit/licenses/jev-harness.LICENSE`) |
| `plugins/kit/guards/jev-secret-guard/` | https://github.com/BasmaAbouzied0/jev-secret-guard | 커밋 `9104364`의 **로컬 수정본**. 식별자 필터 변경(`fix/skip-code-identifiers`)은 원본에 올라가 있지 않다 | MIT, © Basma Nageh Abouzied (`guards/jev-secret-guard/LICENSE`) |
| `plugins/kit/guards/jev-auto-approve/` | https://github.com/BasmaAbouzied0/jev-auto-approve | 커밋 `d8e6366` | MIT, © Basma Nageh Abouzied (`guards/jev-auto-approve/LICENSE`) |
| `plugins/kit/hooks/skillpick-hook.sh`와 `/kit:setup`이 받는 skillpick | https://github.com/govindup63/skillpick (설치는 kit가 클론, 코드는 kit에 없다) | 설치 시점 `main` | MIT (`package.json`) |

### 이 저장소에서 직접 만든 것

- `plugins/kit/skills/setup/` (`/kit:setup`과 `kit_setup.py`), `plugins/kit/hooks/skillpick-hook.sh`, `plugins/kit/hooks/hooks.json`, `sync.sh`, `install.sh`, 마켓플레이스와 플러그인 매니페스트
- `plugins/kit/skills/context7-mcp/`: 작성자의 자작 스킬. 원본 저장소는 없다
- `plugins/kit/assets/statusline.sh`, `plugins/kit/assets/CLAUDE.md`, `plugins/kit/assets/rules/context7.md`: 작성자의 개인 설정 파일. 공개 전에 내용을 다시 확인한다

## 라이선스

jev-harness(© dansya-arsana), jev-secret-guard·jev-auto-approve(© Basma Nageh Abouzied)는 MIT이며 원본 LICENSE를 `plugins/kit/licenses/`와 `plugins/kit/guards/*/`에 함께 둔다.
