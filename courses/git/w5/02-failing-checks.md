# Упавшие проверки

Вы отправили коммит, а через минуту рядом с ним красный крестик. Паниковать не нужно: CI для того и нужен, чтобы ошибку увидели раньше пользователей. Важно быстро понять, какой шаг упал и почему, исправить и отправить коммит снова. В этом уроке вы научитесь читать журналы запусков, разберёте три самые частые причины падения и увидите, как обязательные проверки не пускают сломанный код в `main`.

Как и в прошлом уроке, проверки выполняет учебный раннер внутри приложения.

### Код выхода

Каждая команда, завершаясь, сообщает **код выхода** — число. `0` значит успех, любое другое число — ошибку. CI смотрит только на него: шаг упал, если какая-то его команда вернула не `0`.

```sh
команда1 && команда2
команда1 || команда2
```

- `&&` — выполнить `команда2`, только если `команда1` вернула `0`;
- `||` — выполнить `команда2`, только если `команда1` вернула не `0`;
- `test` возвращает `1`, если условие не выполнено; `grep` — `1`, если строка не найдена, и `2`, если нет самого файла.

```sh example
test -f index.html && echo "index.html на месте"
test -f menu.html || echo "menu.html нет, код выхода не 0"
```

В журнале GitHub Actions упавший шаг заканчивается строкой `Error: Process completed with exit code 1.` — это и есть код выхода последней команды.

### npm test в CI

В JavaScript-проектах проверки описывают в `package.json`, в разделе `scripts`. CI запускает их той же командой, что и разработчик.

```json
{
  "name": "проект",
  "version": "1.0.0",
  "scripts": {
    "test": "команда проверки"
  }
}
```

- `scripts` — именованные команды проекта;
- `"test"` — команда, которую выполняет `npm test`; кавычки внутри строки экранируют: `\"`;
- `npm ci` — установить зависимости перед тестами; в учебном раннере пакеты не скачиваются, команда просто проходит;
- код выхода `npm test` равен коду выхода команды проверки.

```sh example
cat > package.json <<'EOF'
{
  "name": "coffee",
  "version": "1.0.0",
  "scripts": {
    "test": "grep -q \"Меню\" menu.html"
  }
}
EOF
npm test || echo "Тесты не прошли"
```

Добавим workflow, который запускает эти тесты. В примере файл записан одной командой; вы набираете его в редакторе и сохраняете Ctrl+S.

```sh example
cat > .github/workflows/tests.yml <<'EOF'
name: Tests
on: push
jobs:
  unit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm test
EOF
git add package.json .github/workflows/tests.yml
git commit -m "Тесты в CI"
git push
```

### Журнал упавшего запуска

Сначала найдите запуск, потом откройте его журнал.

```sh
gh run list
gh run view ID --log-failed
gh run view ID --log
```

- `gh run list` — номер нужного запуска в колонке `ID`; у каждого workflow свой запуск, даже если коммит один;
- `--log-failed` — только строки упавших шагов: что напечатала команда и с каким кодом завершилась;
- `--log` — журнал всех шагов целиком;
- каждая строка журнала начинается с имени задания и имени шага.

Тот же журнал есть во вкладке «Хостинг» → Actions: щёлкните запуск, затем задание.

```sh example
gh run list
gh run view 3 --log-failed
```

Журнал говорит: в задании `unit` упал шаг `Run npm test`. Команда `grep -q "Меню" menu.html` сообщила `No such file or directory` и завершилась с кодом `2`: файла `menu.html` нет в коммите.

### Три частые причины

**1. Файл не попал в коммит.** Локально всё работает, а в CI `test -f` падает. Раннер видит только отправленный коммит. Проверьте `git status`: забытый файл висит в `Untracked files`.

**2. Падает `npm test`.** Журнал показывает команду из `package.json` после строки `> имя@версия test`. Выполните ту же проверку в терминале, найдите, чего не хватает, и исправьте код, а не тест.

**3. Ошибка в YAML.** Если файл workflow не разбирается, задания не выполняются вовсе. Вместо них в запуске одно задание `Invalid workflow file`:

```text
X Invalid workflow file
Invalid workflow file	Разбор файла	Invalid workflow file: .github/workflows/ci.yml#L8
Invalid workflow file	Разбор файла	A block sequence may not be used as an implicit map key at line 8, column 1:
```

- `#L8` — номер строки, где разбор сломался;
- почти всегда причина в отступах: элемент списка `- run:` сдвинут относительно соседних шагов, или в отступе есть табуляция;
- откройте файл в редакторе и выровняйте строки одного уровня по одному столбцу.

### Исправить и отправить снова

Перезапускать CI отдельной командой не нужно. Исправление — обычный коммит: `git add`, `git commit`, `git push`. Новый push создаёт новый запуск, а значок у ветки показывает результат **последнего** запуска.

```sh example
echo "<h2>Меню</h2>" > menu.html
git add menu.html
git commit -m "Страница меню"
git push
gh run list
```

Workflow `Tests` теперь проходит. `CI` по-прежнему падает, но уже по своей причине: у каждого workflow свой журнал.

### Обязательные проверки

Ветку `main` можно защитить так, что pull request нельзя слить, пока CI на нём не прошёл. Это **обязательные проверки** (required checks). Их включают в настройках защиты ветки, вкладка «Хостинг» → «Настройки», раздел «Защита ветки».

Чтобы проверки появились у pull request, workflow должен реагировать на событие `pull_request`:

```yaml
on: [push, pull_request]
```

Если проверки упали, слияние отклоняется:

```text
$ gh pr merge
Pull request #1 is not mergeable: проверки CI не прошли
```

- исправление делают в той же ветке pull request и отправляют `git push`;
- push в ветку открытого pull request заново запускает проверки;
- когда они прошли, `gh pr merge` сливает pull request.

### gh pr checks

```sh
gh pr checks
gh pr checks номер
```

- без номера — проверки pull request текущей ветки;
- каждая строка: статус, `workflow/задание` и событие;
- если хоть одна проверка не прошла, команда сама завершается с кодом `1`.

```text
$ gh pr checks
X  CI/test (pull_request)
```

После исправления та же команда показывает `✓  CI/test (pull_request)`.

### Частые ошибки

- Перезапускать push без изменений → `Everything up-to-date`, новый запуск не появится. Сначала исправьте и закоммитьте.
- Чинить тест вместо кода (удалить шаг или проверку) → CI зелёный, ошибка осталась. Исправляйте причину из журнала.
- Править YAML «на глаз» → снова `Invalid workflow file`. Сверяйте столбец каждой строки с соседними того же уровня.
- Исправление отправлено в `main`, а pull request открыт из другой ветки → его проверки не изменятся. Коммитьте в ветку pull request.

### Шпаргалка

- код выхода: `0` — успех, иначе ошибка; `&&`, `||`
- `gh run list`, `gh run view ID --log-failed`, `gh run view ID --log`
- `package.json`: `"scripts": { "test": "…" }`; в CI `npm ci`, затем `npm test`
- `Invalid workflow file … #LN` — ошибка YAML в строке N
- исправление = `git add`, `git commit`, `git push` → новый запуск
- `on: [push, pull_request]` — проверки и у pull request
- `gh pr checks` — статус проверок; `gh pr merge` — когда всё ✓

## task git-fix-forgotten-file

```json
{
  "type": "ci",
  "title": "Забытый файл",
  "xp": 15,
  "hints": [
    "Разделы «Журнал упавшего запуска» и «Три частые причины».",
    "gh run view 1 --log-failed покажет упавший шаг. Затем git status: какой файл есть у вас, но не в коммите?",
    "git add …, git commit -m \"…\", git push."
  ],
  "check": {
    "files": [
      ".github/workflows/ci.yml"
    ]
  }
}
```

Сайт кофейни в `~/site` опубликован на учебном GitHub. Workflow `CI` проверяет, что на месте `index.html` и `style.css`, — и первый же запуск на `main` упал. Терминал открыт в папке проекта.

Прочитайте журнал запуска, найдите причину и исправьте её, не меняя workflow. Последний запуск на `main` должен пройти.

```sh setup
mkdir site
cd site
git init -q
cat > index.html <<'EOF'
<html>
<head>
<title>Кофейня «Зерно»</title>
<link rel="stylesheet" href="style.css">
</head>
<body>
<h1>Кофейня «Зерно»</h1>
</body>
</html>
EOF
echo "h1 { color: brown; }" > style.css
mkdir -p .github/workflows
cat > .github/workflows/ci.yml <<'EOF'
name: CI
on: push
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Страница на месте
        run: test -f index.html
      - name: Стили на месте
        run: test -f style.css
EOF
git add index.html .github/workflows/ci.yml
git commit -q -m "Сайт кофейни"
gh repo create site --public --source=. --push
```

```sh solution
gh run view 1 --log-failed
git status
git add style.css
git commit -m "Добавлены стили"
git push
```

## task git-fix-npm-test

```json
{
  "type": "ci",
  "title": "Падает npm test",
  "xp": 15,
  "hints": [
    "Раздел «npm test в CI»: что именно выполняет npm test, написано в package.json.",
    "Журнал (gh run view 1 --log-failed) показывает команду теста. Она ищет строку в index.html. Добавьте эту строку в файл через редактор.",
    "В <head> файла index.html нужна строка вида <title>…</title>. Затем git add index.html, git commit -m \"…\", git push."
  ],
  "check": {
    "files": [
      "package.json",
      ".github/workflows/ci.yml"
    ]
  }
}
```

Интернет-магазин в `~/shop` опубликован на учебном GitHub. Workflow `CI` выполняет `npm ci` и `npm test`, и запуск на `main` падает. Терминал открыт в папке проекта.

Выясните по журналу, что проверяет тест, и исправьте `index.html`, а не тест: у страницы должен появиться заголовок `<title>Магазин «Полка»</title>` внутри `<head>`. Закоммитьте и отправьте исправление. Последний запуск на `main` должен пройти.

```sh setup
mkdir shop
cd shop
git init -q
cat > index.html <<'EOF'
<html>
<head>
</head>
<body>
<h1>Магазин «Полка»</h1>
</body>
</html>
EOF
cat > package.json <<'EOF'
{
  "name": "shop",
  "version": "1.0.0",
  "scripts": {
    "test": "grep -q \"<title>\" index.html"
  }
}
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
      - run: npm ci
      - run: npm test
EOF
git add index.html package.json .github/workflows/ci.yml
git commit -q -m "Магазин и тесты"
gh repo create shop --public --source=. --push
```

```sh solution
gh run view 1 --log-failed
cat > index.html <<'EOF'
<html>
<head>
<title>Магазин «Полка»</title>
</head>
<body>
<h1>Магазин «Полка»</h1>
</body>
</html>
EOF
git add index.html
git commit -m "Заголовок страницы"
git push
```

## task git-fix-yaml-indent

```json
{
  "type": "ci",
  "title": "Invalid workflow file",
  "xp": 20,
  "hints": [
    "Раздел «Три частые причины», пункт про ошибку в YAML.",
    "gh run view 1 --log-failed назовёт строку. Сравните её отступ с соседним шагом: элементы одного списка начинаются в одном столбце.",
    "Оба шага должны начинаться одинаково:\n      - uses: actions/checkout@v4\n      - run: …\nПосле правки: git add …, git commit -m \"…\", git push."
  ],
  "check": {
    "files": [
      ".github/workflows/ci.yml"
    ]
  }
}
```

В проекте документации `~/docs` есть workflow `.github/workflows/ci.yml` с заданием `check`. После push на учебном GitHub вместо проверки появилось задание `Invalid workflow file`. Терминал открыт в папке проекта.

Найдите по журналу строку с ошибкой, исправьте отступ в редакторе, закоммитьте и отправьте. Шаги workflow менять не нужно. Последний запуск на `main` должен пройти.

```sh setup
mkdir docs
cd docs
git init -q
echo "# Руководство пользователя" > guide.md
mkdir -p .github/workflows
cat > .github/workflows/ci.yml <<'EOF'
name: Docs
on: push
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
     - run: test -f guide.md
EOF
git add guide.md .github/workflows/ci.yml
git commit -q -m "Руководство и CI"
gh repo create docs --public --source=. --push
```

```sh solution
gh run view 1 --log-failed
cat > .github/workflows/ci.yml <<'EOF'
name: Docs
on: push
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: test -f guide.md
EOF
git add .github/workflows/ci.yml
git commit -m "Исправлен отступ в CI"
git push
```

## task git-required-checks

```json
{
  "type": "hosting",
  "title": "Проверки не пускают в main",
  "xp": 20,
  "hints": [
    "Разделы «Обязательные проверки» и «gh pr checks».",
    "gh pr checks и gh run view … --log-failed покажут, что сломано. Исправьте файл в ветке prices, закоммитьте и отправьте — проверки запустятся заново.",
    "В <head> файла index.html верните строку <title>…</title>. Затем git add, git commit -m \"…\", git push, gh pr checks и gh pr merge."
  ],
  "check": { "branches": false }
}
```

В проекте `~/cafe` ветка `main` защищена: pull request сливается только после успешных проверок CI. Вы работаете в ветке `prices` и уже открыли pull request «Страница цен», но `gh pr merge` его не сливает. Терминал открыт в папке проекта.

Выясните, какая проверка не прошла, исправьте причину в ветке `prices` (у `index.html` пропал заголовок; верните `<head>` со строкой `<title>Кафе «Пирожок»</title>`), отправьте исправление и слейте pull request обычным слиянием.

```sh setup
mkdir cafe
cd cafe
git init -q
cat > index.html <<'EOF'
<html>
<head>
<title>Кафе «Пирожок»</title>
</head>
<body>
<h1>Кафе «Пирожок»</h1>
</body>
</html>
EOF
mkdir -p .github/workflows
cat > .github/workflows/ci.yml <<'EOF'
name: CI
on: [push, pull_request]
jobs:
  pages:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Заголовок страницы
        run: grep -q "<title>" index.html
EOF
git add index.html .github/workflows/ci.yml
git commit -q -m "Сайт кафе"
gh repo create cafe --public --source=. --push
hosting protect student/cafe main --checks
git switch -c prices
cat > index.html <<'EOF'
<html>
<body>
<h1>Кафе «Пирожок»</h1>
<a href="prices.html">Цены</a>
</body>
</html>
EOF
echo "<h1>Цены</h1>" > prices.html
git add index.html prices.html
git commit -q -m "Страница цен"
git push -q -u origin prices
gh pr create --title "Страница цен" --body "Добавлена страница с ценами"
```

```sh solution
gh pr checks || echo "проверки не прошли"
gh run view 3 --log-failed
cat > index.html <<'EOF'
<html>
<head>
<title>Кафе «Пирожок»</title>
</head>
<body>
<h1>Кафе «Пирожок»</h1>
<a href="prices.html">Цены</a>
</body>
</html>
EOF
git add index.html
git commit -m "Вернул заголовок страницы"
git push
gh pr checks
gh pr merge
```
