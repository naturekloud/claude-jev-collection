# claude-jev-collection

jungyu의 Claude Code 환경을 한 번에 설치하는 로컬 마켓플레이스다. 플러그인 `kit@claude-jev-collection` 하나를 설치하면 아래 구성이 함께 들어온다.

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

## 라이선스

jev-harness(© dansya-arsana), jev-secret-guard·jev-auto-approve(© Basma Nageh Abouzied)는 MIT이며 원본 LICENSE를 `plugins/kit/licenses/`와 `plugins/kit/guards/*/`에 함께 둔다.
