# GitHub Actions: первый workflow

Коллега поправил сайт, отправил коммит — и главная страница пропала: файл переименовали, а ссылку забыли. Заметили это через неделю. **CI** (continuous integration, непрерывная интеграция) ловит такие ошибки сразу: после каждого `git push` сервер сам забирает коммит и выполняет проверки. Если проверка упала, все видят красный крестик рядом с коммитом. В этом уроке вы напишете первый workflow для GitHub Actions и научитесь смотреть результаты запусков.

Проверки здесь выполняет **учебный раннер** — модель внутри приложения. Ему доступны команды песочницы (`cd`, `ls`, `cat`, `echo`, `mkdir`, `touch`, `rm`, `mv`), а также `test`, `grep` и `npm test`. Настоящие программы, сеть и Docker не используются.

### Как устроен CI

GitHub Actions читает файлы из папки `.github/workflows` в отправленном коммите. Каждый такой файл — **workflow**, сценарий проверки. Порядок такой:

1. Вы делаете `git push`.
2. Хостинг находит workflow, которые реагируют на это событие, и создаёт **запуск** (run).
3. Запуск выполняет **задания** (jobs), задание — **шаги** (steps), шаг — одну или несколько команд.
4. Если любая команда шага завершилась ошибкой, шаг и задание помечаются ✗, а запуск — упавшим.

Workflow лежит в репозитории, поэтому его меняют обычными коммитами, как любой другой файл.

### YAML: формат файла workflow

Workflow пишут в формате **YAML**. Это текст из пар «ключ: значение», вложенность задаётся отступами.

```yaml
ключ: значение
раздел:
  вложенный-ключ: значение
список:
  - первый элемент
  - второй элемент
короткий-список: [первый, второй]
# комментарий до конца строки
```

- `ключ: значение` — после двоеточия обязателен пробел;
- вложенность — отступ **пробелами**, обычно по два на уровень; табуляция в YAML запрещена;
- элементы на одном уровне начинаются в одном столбце, иначе файл не разберётся;
- `- ` — элемент списка; `[a, b]` — тот же список в одну строку;
- `#` — комментарий, его YAML пропускает.

### Структура workflow

Шаблон минимального workflow:

```yaml
name: Имя
on: push
jobs:
  id-задания:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: команда
```

- `name` — имя workflow; его показывают список запусков и вкладка «Хостинг»;
- `on` — событие, которое запускает workflow: `push` — отправка коммитов, `pull_request` — открытие и обновление pull request; оба сразу — `on: [push, pull_request]`;
- `jobs` — словарь заданий; `id-задания` — имя задания латиницей, например `check`;
- `runs-on` — на какой машине выполнять задание; `ubuntu-latest` — стандартная машина с Linux, здесь её изображает учебный раннер;
- `steps` — список шагов по порядку; каждый шаг начинается с `- `.

Запуск только для нужных веток задают так:

```yaml
on:
  push:
    branches: [main]
```

- `push:` теперь раздел, а не значение;
- `branches` — список веток; push в другие ветки workflow не запускает.

### Шаги: uses и run

Шаг бывает двух видов.

```yaml
      - uses: владелец/действие@версия
      - run: команда
      - name: Название шага
        run: |
          первая команда
          вторая команда
```

- `uses` — готовое действие; `actions/checkout@v4` скачивает файлы вашего коммита в рабочую папку раннера;
- `run` — команда оболочки; задание выполняет шаги сверху вниз;
- `name` — подпись шага в журнале; без неё шаг называется `Run команда`;
- `run: |` — несколько команд, каждая на своей строке с отступом; шаг падает на первой ошибке.

Раннер начинает работу с **пустой** папки. Без шага `actions/checkout@v4` файлов проекта в ней нет, и любая проверка файла упадёт. Поэтому checkout почти всегда первый шаг.

### Проверки: test и grep

Шаг проходит, если его команды завершились успешно. Для проверок есть две команды.

```sh
test -f файл
grep -q "текст" файл
```

- `test -f файл` — успех, если файл существует; `test -d папка` — то же для папки;
- `grep "текст" файл` — печатает строки файла, где встречается текст; успех, если такая строка есть;
- `-q` — ничего не печатать, только сообщить результат: удобно в CI.

```sh example
test -f README.md && echo "README на месте"
grep "фотостудии" README.md
grep -q "<title>" index.html && echo "Заголовок есть"
```

Знак `&&` выполняет вторую команду, только если первая прошла успешно.

### Создаём файл workflow

Файл workflow создаётся в терминале, а текст набирается в редакторе.

```sh
mkdir -p .github/workflows
touch .github/workflows/ci.yml
```

- `mkdir -p` — создать папку вместе с недостающими родительскими; без ошибки, если она уже есть;
- `touch файл` — создать пустой файл;
- затем откройте `ci.yml` в панели «Файлы» (папка `.github/workflows`), наберите текст в «Редакторе» и сохраните **Ctrl+S**;
- дальше обычный путь: `git add`, `git commit`, `git push`.

Имя `.github` начинается с точки, поэтому `ls` его не показывает — нужен `ls -a`.

```sh example
mkdir -p .github/workflows
touch .github/workflows/pages.yml
ls -a
```

В примере ниже текст файла записан одной командой, чтобы его можно было выполнить кнопкой. Вы набираете тот же текст в редакторе. Этот workflow проверяет README и печатает список файлов.

```sh example
cat > .github/workflows/pages.yml <<'EOF'
name: Pages
on: push
jobs:
  readme:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: test -f README.md
      - name: Описание проекта
        run: |
          echo "Файлы проекта:"
          ls
          grep -q "фотостудии" README.md
EOF
git add .github/workflows/pages.yml
git commit -m "Проверка README в CI"
git push
```

### Результаты запусков

После `git push` откройте вкладку «Хостинг» и страницу **Actions**: там список запусков, задания, шаги и их журналы. То же самое видно в терминале.

```sh
gh run list
gh run view
gh run view ID
```

- `gh run list` — запуски, новые сверху: статус (`✓` прошёл, `X` упал), сообщение коммита, имя workflow, ветка, событие и `ID`;
- `gh run view` — подробности последнего запуска: задания и шаги со статусами;
- `gh run view ID` — подробности конкретного запуска по номеру из списка.

```sh example
gh run list
gh run view 1
```

### Частые ошибки

- Файл лежит в `.github/workflow/ci.yml` или `github/workflows/ci.yml` → GitHub его не видит, запусков нет. Путь строго `.github/workflows/`.
- Нет шага `actions/checkout@v4` → папка раннера пуста, `test -f index.html` падает. Ставьте checkout первым шагом.
- `on: push` с `branches: [master]`, а ветка называется `main` → workflow молчит. Сверьте имя ветки с `git branch`.
- Файл создан, но не отправлен → CI читает только запушенные коммиты. Нужны `git add`, `git commit` и `git push`.

### Шпаргалка

- `.github/workflows/имя.yml` — файл workflow
- `name`, `on: push`, `on: [push, pull_request]`, `on: push: branches: [main]`
- `jobs` → `id-задания` → `runs-on: ubuntu-latest` → `steps`
- `- uses: actions/checkout@v4` — файлы коммита в раннер
- `- run: команда`, `- name: …` + `run: |` — несколько команд
- `test -f файл`, `grep -q "текст" файл`, `&&`
- `mkdir -p папка`, `touch файл`, `ls -a`
- `gh run list`, `gh run view`, `gh run view ID`; вкладка «Хостинг» → Actions

## task git-first-workflow

```json
{
  "type": "ci",
  "title": "Первый workflow",
  "xp": 10,
  "hints": [
    "Перечитайте разделы «Структура workflow» и «Создаём файл workflow».",
    "Сначала mkdir -p .github/workflows, затем создайте ci.yml, откройте его в «Файлах», наберите текст и сохраните Ctrl+S. После этого git add, git commit и git push.",
    "Шаблон файла:\nname: CI\non: push\njobs:\n  check:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: …\n      - run: test -f …\n      - run: grep -q \"…\" index.html"
  ]
}
```

Сайт фотостудии лежит в `~/site` и уже опубликован на учебном GitHub как `student/site`. В репозитории есть `index.html` и `README.md`. Терминал открыт в папке проекта.

Добавьте проверку CI в файле `.github/workflows/ci.yml`:

- workflow называется `CI` и запускается при `push`;
- одно задание `check` на `ubuntu-latest`;
- шаги: получить файлы коммита (`actions/checkout@v4`), проверить, что существует `index.html`, проверить, что в `index.html` есть строка с `<title>`.

Закоммитьте файл и отправьте его в `main`. Последний запуск на `main` должен пройти.

```sh setup
mkdir site
cd site
git init -q
cat > index.html <<'EOF'
<!DOCTYPE html>
<html>
<head>
<title>Фотостудия «Кадр»</title>
</head>
<body>
<h1>Фотостудия «Кадр»</h1>
</body>
</html>
EOF
echo "# Сайт фотостудии «Кадр»" > README.md
git add index.html README.md
git commit -q -m "Первая версия сайта"
gh repo create site --source=. --push
```

```sh solution
mkdir -p .github/workflows
cat > .github/workflows/ci.yml <<'EOF'
name: CI
on: push
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: test -f index.html
      - run: grep -q "<title>" index.html
EOF
git add .github/workflows/ci.yml
git commit -m "Проверка сайта в CI"
git push
```

## task git-view-runs

```json
{
  "type": "commands",
  "title": "Найти нужный запуск",
  "xp": 10,
  "hints": [
    "Раздел «Результаты запусков».",
    "Сначала список запусков: в колонке TITLE — сообщение коммита, в колонке ID — номер запуска.",
    "gh run list, затем gh run view … с номером запуска коммита «Пост о весне»."
  ],
  "check": {
    "require": [
      { "pattern": "^gh run list\\b", "message": "Посмотрите список запусков: gh run list" },
      { "pattern": "^gh run view\\s+#?2\\b", "message": "Откройте подробности запуска коммита «Пост о весне» по его номеру: gh run view <ID>" }
    ]
  }
}
```

В блоге `~/blog` уже настроен CI, а на учебном GitHub прошло несколько запусков. Терминал открыт в папке проекта.

Выведите список запусков, найдите запуск коммита **Пост о весне** и откройте его подробности по номеру.

```sh setup
mkdir blog
cd blog
git init -q
echo "Первый пост" > post1.md
mkdir -p .github/workflows
cat > .github/workflows/ci.yml <<'EOF'
name: CI
on: push
jobs:
  posts:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: test -f post1.md
EOF
git add post1.md .github/workflows/ci.yml
git commit -q -m "Первый пост и CI"
gh repo create blog --source=. --push
echo "Весна пришла" > post2.md
git add post2.md
git commit -q -m "Пост о весне"
git push -q
echo "Летние планы" > post3.md
git add post3.md
git commit -q -m "Пост о лете"
git push -q
```

```sh solution
gh run list
gh run view 2
```

## task git-fix-trigger

```json
{
  "type": "ci",
  "title": "Workflow не запускается",
  "xp": 15,
  "hints": [
    "Раздел «Структура workflow»: как on: push ограничивают списком веток.",
    "Посмотрите, в какой ветке вы работаете (git branch), и сравните с branches в файле. Исправьте файл в редакторе, сохраните Ctrl+S, закоммитьте и отправьте.",
    "В файле должно стать:\non:\n  push:\n    branches: [ … ]\nЗатем git add …, git commit -m \"…\", git push."
  ]
}
```

В проекте `~/notes` есть workflow `.github/workflows/ci.yml` с заданием `build`, он уже отправлен на учебный GitHub. Но на вкладке Actions пусто: workflow настроен на ветку `master`, а проект живёт в `main`.

Исправьте раздел `on`, чтобы workflow запускался при push в `main`, закоммитьте изменение и отправьте его. Последний запуск на `main` должен пройти.

```sh setup
mkdir notes
cd notes
git init -q
echo "Заметки команды" > README.md
mkdir -p .github/workflows
cat > .github/workflows/ci.yml <<'EOF'
name: CI
on:
  push:
    branches: [master]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: test -f README.md
EOF
git add README.md .github/workflows/ci.yml
git commit -q -m "Заметки и CI"
gh repo create notes --source=. --push
```

```sh solution
cat > .github/workflows/ci.yml <<'EOF'
name: CI
on:
  push:
    branches: [main]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: test -f README.md
EOF
git add .github/workflows/ci.yml
git commit -m "CI для ветки main"
git push
```

## task git-checkout-quiz

```json
{
  "type": "choice",
  "title": "Зачем нужен checkout",
  "xp": 10,
  "hints": [
    "Раздел «Шаги: uses и run».",
    "С чего начинает работу раннер — с копии репозитория или с пустой папки?"
  ],
  "options": [
    "Шаг пройдёт: раннер сам берёт файлы из репозитория",
    "Шаг упадёт: без checkout рабочая папка раннера пуста",
    "Workflow не запустится: без checkout файл считается неверным",
    "Шаг пропустится, а запуск будет отмечен как успешный"
  ],
  "answer": [1],
  "explanation": "Раннер начинает с пустой папки, файлы коммита туда копирует `actions/checkout@v4`. Без него `test -f index.html` не находит файл и шаг падает. Сам файл workflow при этом корректен, поэтому запуск создаётся; шаги без условий не пропускаются."
}
```

В workflow единственное задание, его шаги:

```yaml
    steps:
      - run: test -f index.html
```

Файл `index.html` в репозитории есть. Что произойдёт при `git push`?
