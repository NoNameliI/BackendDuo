# Условия в CI: публикация только из main

Проверки полезно запускать на каждой ветке, а публиковать сайт — только из `main` и только когда проверки прошли. Иначе черновик из ветки `dev` окажется у пользователей. Для этого в CI есть условия: задание выполняется, только если ветка подходит и предыдущие задания прошли. В этом уроке вы соберёте такой порядок в GitHub Actions и в GitLab CI.

Публикация в учебном раннере — это команда `echo`: сеть и настоящие серверы не используются, важен порядок заданий и их статусы.

### needs — порядок заданий

В GitHub Actions задания одного workflow независимы и выполняются в любом порядке. `needs` говорит: «это задание — только после тех».

```yaml
jobs:
  первое:
    runs-on: ubuntu-latest
    steps:
      - run: команда
  второе:
    needs: первое
    runs-on: ubuntu-latest
    steps:
      - run: команда
```

- `needs: первое` — `второе` ждёт, пока `первое` закончится;
- несколько зависимостей — списком: `needs: [lint, test]`;
- если задание из `needs` упало или пропущено, зависимое задание **пропускается** (статус `-`, skipped);
- у каждого задания своя чистая машина: файлы коммита нужны — нужен свой `actions/checkout@v4`.

### if — условие для задания

```yaml
  задание:
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
```

- `if` — выражение; задание выполняется, только если оно истинно, иначе пропускается;
- `github.ref` — полная ссылка, из-за которой начался запуск: для push в `main` это `refs/heads/main`;
- `==` — равно, `!=` — не равно; строки — в одинарных кавычках;
- `&&` и `||` объединяют условия: `github.ref == 'refs/heads/main' && github.event_name == 'push'`;
- `if` можно поставить и у шага — тогда пропускается только этот шаг.

Условие проверяется уже после `needs`: если зависимость упала, задание пропущено при любом `if`.

### Контекст github и выражения ${{ }}

Данные о запуске лежат в **контексте** `github`. В `if` их пишут как есть, а в тексте команды или имени шага — внутри `${{ }}`.

```yaml
      - run: echo "Ветка ${{ github.ref_name }}"
```

- `github.ref_name` — короткое имя ветки: `main`, `dev`;
- `github.sha` — полный идентификатор коммита;
- `github.event_name` — событие: `push` или `pull_request`;
- `github.actor` — кто сделал push;
- `${{ выражение }}` заменяется значением до выполнения команды.

### env — переменные окружения

```yaml
env:
  ИМЯ: значение
jobs:
  задание:
    env:
      ДРУГОЕ: значение
    steps:
      - run: echo "$ИМЯ и $ДРУГОЕ"
```

- `env` на верхнем уровне — для всех заданий; внутри задания или шага — только для него;
- в команде переменная пишется как `$ИМЯ`; подставляет её раннер, терминал песочницы `$` не подставляет;
- одноимённая переменная задания перекрывает переменную workflow.

Пример: workflow печатает переменные и имя ветки. Текст файла записан одной командой; вы набираете его в редакторе.

```sh example
cat > .github/workflows/info.yml <<'EOF'
name: Info
on: push
env:
  SITE: yoga
jobs:
  about:
    runs-on: ubuntu-latest
    env:
      GREETING: Привет
    steps:
      - run: echo "$GREETING из ветки ${{ github.ref_name }}, сайт $SITE"
EOF
git add .github/workflows/info.yml
git commit -m "Workflow с переменными"
git push
gh run list
gh run view 4 --log
```

### needs и if вместе

Пример: задание `preview` выкладывает черновую версию, но только **не** из `main` и только после проверки.

```sh example
cat > .github/workflows/preview.yml <<'EOF'
name: Preview
on: push
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: test -f index.html
  preview:
    needs: check
    if: github.ref != 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - run: echo "Черновик ветки ${{ github.ref_name }}"
EOF
git add .github/workflows/preview.yml
git commit -m "Черновой просмотр веток"
git push
gh run view 7
```

На ветке `dev` оба задания прошли. Перенесём изменения в `main`: там `preview` будет пропущен.

```sh example
git switch main
git merge dev
git push
gh run view 10
```

### GitLab: rules и if

В GitLab условие задания пишут в `rules`. Это список правил; GitLab проверяет их сверху вниз, и первое подходящее решает судьбу задания.

```yaml
задание:
  stage: deploy
  script:
    - команда
  rules:
    - if: $CI_COMMIT_BRANCH == "main"
```

- `rules` — список; каждое правило начинается с `- `;
- `if` — условие с переменными: `$CI_COMMIT_BRANCH == "main"`; строки — в двойных кавычках; `!=`, `&&`, `||` тоже работают;
- подошло правило — задание добавляется в пайплайн; не подошло ни одно — задания в пайплайне нет вовсе;
- если в пайплайне не осталось ни одного задания, пайплайн не создаётся.

### GitLab: when: manual

```yaml
  rules:
    - if: $CI_COMMIT_BRANCH == "main"
      when: manual
```

- `when: manual` — задание добавляется, но само не стартует: его запускают кнопкой, когда команда готова к выпуску;
- `when` пишут в том же правиле, с отступом под `if`;
- без `rules` можно написать `when: manual` прямо в задании — тогда оно ручное на любой ветке;
- в `glab ci view` ручное задание отмечено `▶`; в учебном хостинге оно так и остаётся в ожидании.

### GitLab: allow_failure

Не каждая проверка должна останавливать выпуск. Например, проверка орфографии полезна, но опечатка не повод отменять публикацию.

```yaml
задание:
  stage: test
  script:
    - команда
  allow_failure: true
```

- `allow_failure: true` — если задание упало, оно отмечено `X`, но следующие стадии всё равно выполняются;
- пайплайн при этом считается успешным (`passed`);
- по умолчанию `allow_failure` выключен.

Пайплайн со всеми тремя приёмами и его результат при push в `main`:

```yaml
stages:
  - test
  - deploy

lint:
  stage: test
  script:
    - grep -q "TODO" index.html
  allow_failure: true

files:
  stage: test
  script:
    - test -f index.html

publish:
  stage: deploy
  script:
    - echo "Публикую"
  rules:
    - if: $CI_COMMIT_BRANCH == "main"
      when: manual
```

```text
$ glab ci view
✓ main pipeline · 2
Triggered via push · commit 01ac11d

JOBS
X lint (test)
✓ files (test)
▶ publish (deploy)
```

### Частые ошибки

- `if: github.ref == 'main'` → условие всегда ложно: в `github.ref` полная ссылка. Пишите `'refs/heads/main'` или сравнивайте `github.ref_name == 'main'`.
- `if: github.ref == "refs/heads/main"` в GitHub → строки в выражениях только в одинарных кавычках. В GitLab, наоборот, привычны двойные: `$CI_COMMIT_BRANCH == "main"`.
- Публикация без `needs` → она может пройти, даже когда тесты упали. Ставьте `needs: test`.
- `when: manual` на одном уровне с `rules`, а не внутри правила → такой `when` вместе с `rules` не работает, настоящий GitLab и вовсе не примет файл. Пишите `when` под `if` того же элемента списка.

### Шпаргалка

- `needs: задание`, `needs: [a, b]` — порядок; упала зависимость → пропуск
- `if: github.ref == 'refs/heads/main'`, `!=`, `&&`, `||`
- `${{ github.ref_name }}`, `${{ github.sha }}`, `github.event_name`, `github.actor`
- `env:` на уровне workflow, задания, шага; в командах `$ИМЯ`
- GitLab: `rules: - if: $CI_COMMIT_BRANCH == "main"`
- `when: manual` — ручной запуск (`▶`), `allow_failure: true` — падение не останавливает пайплайн

## task git-deploy-only-main

```json
{
  "type": "ci",
  "title": "Публикация только из main",
  "xp": 20,
  "hints": [
    "Разделы «needs — порядок заданий» и «if — условие для задания».",
    "Добавьте в ci.yml второе задание deploy на одном уровне с test. Ему нужны needs, if и runs-on. Затем commit и git push в dev: на dev deploy должен оказаться пропущенным.",
    "Шаблон задания:\n  deploy:\n    needs: …\n    if: github.ref == '…'\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo \"Публикую ${{ github.… }}\"\nЗатем git add, git commit -m \"…\", git push."
  ],
  "check": { "branch": "dev" }
}
```

Сайт студии йоги в `~/site` опубликован на учебном GitHub. В `.github/workflows/ci.yml` одно задание `test`. Вы работаете в ветке `dev`, она уже отправлена на хостинг. Терминал открыт в папке проекта.

Добавьте в этот workflow задание `deploy`:

- выполняется только после успешного `test`;
- выполняется только для push в `main`;
- машина `ubuntu-latest`, один шаг: `echo` с текстом `Публикую` и идентификатором коммита `${{ github.sha }}`.

Закоммитьте изменение в `dev` и отправьте его. В последнем запуске на `dev` задание `test` должно пройти, а `deploy` — быть пропущенным.

```sh setup
mkdir site
cd site
git init -q
cat > index.html <<'EOF'
<html>
<head>
<title>Студия йоги «Баланс»</title>
</head>
<body>
<h1>Студия йоги «Баланс»</h1>
</body>
</html>
EOF
mkdir -p .github/workflows
cat > .github/workflows/ci.yml <<'EOF'
name: CI
on: push
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: grep -q "<title>" index.html
EOF
git add index.html .github/workflows/ci.yml
git commit -q -m "Сайт студии"
gh repo create site --source=. --push
git switch -c dev
git push -q -u origin dev
```

```sh solution
cat > .github/workflows/ci.yml <<'EOF'
name: CI
on: push
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: grep -q "<title>" index.html
  deploy:
    needs: test
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - run: echo "Публикую ${{ github.sha }}"
EOF
git add .github/workflows/ci.yml
git commit -m "Публикация из main"
git push
gh run view
```

## task git-needs-review

```json
{
  "type": "review",
  "title": "Тесты упали в main",
  "xp": 10,
  "hints": [
    "Раздел «needs — порядок заданий»: что происходит с заданием, если его зависимость упала.",
    "Условие if проверяется после needs."
  ],
  "options": [
    "deploy выполнится: push сделан в main, условие if истинно",
    "deploy будет пропущен: задание test, от которого он зависит, упало",
    "deploy упадёт с той же ошибкой, что и test",
    "Workflow не запустится: в файле два условия"
  ],
  "answer": [1],
  "explanation": "`deploy` зависит от `test` через `needs`. Если `test` упал, зависимое задание пропускается, и `if` уже не важен. Падать `deploy` нечему — его шаги не выполнялись. С файлом всё в порядке: `needs` и `if` у одного задания — обычная запись."
}
```

В `main` отправлен коммит, на котором `npm test` падает. Что будет с заданием `deploy`?

```yaml code
name: CI
on: push
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm test
  deploy:
    needs: test
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - run: echo "Публикую ${{ github.sha }}"
```

## task git-gitlab-manual-deploy

```json
{
  "type": "ci",
  "title": "Ручной выпуск в GitLab",
  "xp": 20,
  "hints": [
    "Разделы «GitLab: rules и if» и «GitLab: when: manual».",
    "Добавьте в .gitlab-ci.yml задание deploy в стадии deploy с одним правилом в rules: условие на ветку main и when: manual внутри этого же правила.",
    "Шаблон:\ndeploy:\n  stage: deploy\n  script:\n    - echo \"…\"\n  rules:\n    - if: $CI_COMMIT_BRANCH == \"…\"\n      when: …\nЗатем git add, git commit -m \"…\", git push."
  ]
}
```

Интернет-магазин в `~/shop` опубликован на учебном GitLab. В `.gitlab-ci.yml` две стадии — `test` и `deploy` — и одно задание `pages` в стадии `test`. Терминал открыт в папке проекта.

Добавьте задание `deploy` в стадии `deploy` с командой `echo "Выкладываю магазин"`. Оно должно появляться только в пайплайнах ветки `main` и запускаться вручную. Закоммитьте и отправьте изменение в `main`. В пайплайне на `main` задание `pages` должно пройти, а `deploy` — ждать ручного запуска.

```sh setup
hosting flavor gitlab
mkdir shop
cd shop
git init -q
cat > index.html <<'EOF'
<html>
<head>
<title>Магазин «Корзинка»</title>
</head>
<body>
<h1>Магазин «Корзинка»</h1>
</body>
</html>
EOF
cat > .gitlab-ci.yml <<'EOF'
stages:
  - test
  - deploy

pages:
  stage: test
  script:
    - test -f index.html
    - grep -q "<title>" index.html
EOF
git add index.html .gitlab-ci.yml
git commit -q -m "Магазин и пайплайн"
glab repo create shop
git remote add origin https://gitlab.com/student/shop.git
git push -q -u origin main
```

```sh solution
cat > .gitlab-ci.yml <<'EOF'
stages:
  - test
  - deploy

pages:
  stage: test
  script:
    - test -f index.html
    - grep -q "<title>" index.html

deploy:
  stage: deploy
  script:
    - echo "Выкладываю магазин"
  rules:
    - if: $CI_COMMIT_BRANCH == "main"
      when: manual
EOF
git add .gitlab-ci.yml
git commit -m "Ручной выпуск из main"
git push
glab ci view
```

## task git-gitlab-allow-failure

```json
{
  "type": "ci",
  "title": "Необязательная проверка",
  "xp": 20,
  "hints": [
    "Раздел «GitLab: allow_failure».",
    "Задание spelling падает и останавливает стадию deploy. Ему нужен один дополнительный ключ на уровне stage и script.",
    "В задание spelling добавьте строку\n  allow_failure: …\nЗатем git add, git commit -m \"…\", git push."
  ]
}
```

Новостной сайт в `~/news` опубликован на учебном GitLab. В пайплайне задание `spelling` проверяет отметку корректора и падает, из-за этого задание `deploy` пропускается, а весь пайплайн на `main` — `failed`. Команда решила: проверка орфографии — подсказка, а не запрет на публикацию. Терминал открыт в папке проекта.

Сделайте так, чтобы падение `spelling` не останавливало пайплайн. Саму проверку не удаляйте и не меняйте. Закоммитьте и отправьте изменение. В пайплайне на `main` `spelling` по-прежнему падает, `pages` и `deploy` проходят, а пайплайн целиком — успешен.

```sh setup
hosting flavor gitlab
mkdir news
cd news
git init -q
cat > index.html <<'EOF'
<html>
<head>
<title>Новости района</title>
</head>
<body>
<h1>Новости района</h1>
</body>
</html>
EOF
cat > .gitlab-ci.yml <<'EOF'
stages:
  - test
  - deploy

pages:
  stage: test
  script:
    - test -f index.html

spelling:
  stage: test
  script:
    - grep -q "Проверено корректором" index.html

deploy:
  stage: deploy
  script:
    - echo "Публикую новости"
  rules:
    - if: $CI_COMMIT_BRANCH == "main"
EOF
git add index.html .gitlab-ci.yml
git commit -q -m "Новостной сайт"
glab repo create news
git remote add origin https://gitlab.com/student/news.git
git push -q -u origin main
```

```sh solution
glab ci view
cat > .gitlab-ci.yml <<'EOF'
stages:
  - test
  - deploy

pages:
  stage: test
  script:
    - test -f index.html

spelling:
  stage: test
  script:
    - grep -q "Проверено корректором" index.html
  allow_failure: true

deploy:
  stage: deploy
  script:
    - echo "Публикую новости"
  rules:
    - if: $CI_COMMIT_BRANCH == "main"
EOF
git add .gitlab-ci.yml
git commit -m "Орфография не блокирует публикацию"
git push
glab ci list
```
