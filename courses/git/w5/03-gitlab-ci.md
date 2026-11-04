# GitLab CI/CD

Ваша команда переехала на GitLab, а проверки остались нужны. Идея та же, что в GitHub Actions: после push сервер выполняет проверки и показывает результат. Отличается файл и словарь: в GitLab один файл `.gitlab-ci.yml`, запуск называется **пайплайн** (pipeline), а задания разложены по **стадиям**. В этом уроке вы настроите пайплайн из нескольких стадий, научитесь передавать в него переменные и разбираться, почему он остановился.

Хостинг в этом уроке работает в режиме GitLab, команды для него — `glab`. Проверки выполняет учебный раннер с теми же командами, что и раньше: команды песочницы, `test`, `grep`, `npm test`.

### Файл .gitlab-ci.yml

GitLab ищет файл `.gitlab-ci.yml` в корне репозитория, в отправленном коммите. Если файла нет, пайплайна нет.

- один файл на проект, а не папка с файлами, как у GitHub;
- файлы коммита попадают в раннер сами: шаг checkout не нужен;
- создаётся так же, как workflow: `touch .gitlab-ci.yml`, открыть в «Файлах», набрать текст в «Редакторе», сохранить Ctrl+S, затем `git add`, `git commit`, `git push`.

### Стадии и задания

```yaml
stages:
  - стадия1
  - стадия2

имя-задания:
  stage: стадия1
  script:
    - команда
    - ещё команда
```

- `stages` — список стадий по порядку выполнения; если его нет, стадии такие: `build`, `test`, `deploy`;
- `имя-задания` — любой ключ верхнего уровня, кроме служебных (`stages`, `variables`, `before_script` и других), становится заданием;
- `stage` — стадия задания; без неё задание попадает в `test`;
- `script` — список команд; обязателен, без него GitLab не примет файл;
- команды выполняются по очереди и останавливаются на первой ошибке.

В примере текст файла записан одной командой, чтобы его можно было выполнить кнопкой. Вы набираете его в редакторе.

```sh example
cat > .gitlab-ci.yml <<'EOF'
stages:
  - build
  - test

readme:
  stage: build
  script:
    - test -f README.md

words:
  stage: test
  script:
    - grep -q "библиотеки" README.md
EOF
git add .gitlab-ci.yml
git commit -m "Пайплайн для README"
git push
```

### glab ci list и glab ci view

```sh
glab ci list
glab ci view
glab ci view ID
```

- `glab ci list` — пайплайны, новые сверху: состояние (`passed` или `failed`), номер `#ID`, ветка, источник и сообщение коммита;
- `glab ci view` — задания последнего пайплайна: статус, имя и стадия в скобках;
- `glab ci view ID` — то же для пайплайна с номером `ID`;
- значки: `✓` прошло, `X` упало, `-` пропущено.

Журналы заданий — во вкладке «Хостинг», страница **CI/CD**: щёлкните пайплайн, затем задание.

```sh example
glab ci list
glab ci view
```

### Порядок стадий

Стадии выполняются строго по списку `stages`. Задания одной стадии считаются независимыми. Следующая стадия начинается, только если **все** задания предыдущей прошли.

- упало задание стадии `test` → задания стадий после неё не выполняются и помечаются как пропущенные (`-`);
- пайплайн целиком получает состояние `failed`;
- поэтому дешёвые быстрые проверки ставят в ранние стадии, а публикацию — в последнюю.

```sh example
cat > .gitlab-ci.yml <<'EOF'
stages:
  - build
  - test
  - deploy

readme:
  stage: build
  script:
    - test -f README.md

words:
  stage: test
  script:
    - grep -q "архив" README.md

publish:
  stage: deploy
  script:
    - echo "Публикую сайт"
EOF
git add .gitlab-ci.yml
git commit -m "Публикация после проверок"
git push
glab ci view
```

Задание `words` упало: в README нет слова «архив». Задание `publish` из стадии `deploy` пропущено.

### variables и before_script

Повторяющиеся значения выносят в переменные, а общие команды — в `before_script`.

```yaml
variables:
  ИМЯ: значение

before_script:
  - команда перед каждым заданием

задание:
  script:
    - echo "$ИМЯ"
```

- `variables` — переменные для всех заданий; имена принято писать заглавными латинскими буквами;
- `$ИМЯ` или `${ИМЯ}` в команде заменяется значением; неизвестная переменная становится пустой строкой;
- `before_script` — команды, которые выполняются перед `script` каждого задания;
- `variables` и `before_script` можно написать и внутри задания — тогда они действуют только в нём.

GitLab сам задаёт **предопределённые переменные**: `$CI_COMMIT_BRANCH` — ветка, в которую сделан push, `$CI_COMMIT_SHORT_SHA` — короткий идентификатор коммита, `$CI_PROJECT_NAME` — имя проекта. Переменные работают в командах пайплайна; терминал песочницы `$` не подставляет.

```sh example
cat > .gitlab-ci.yml <<'EOF'
stages:
  - build
  - test

variables:
  DOC: README.md

before_script:
  - echo "Ветка $CI_COMMIT_BRANCH, коммит $CI_COMMIT_SHORT_SHA"

readme:
  stage: build
  script:
    - test -f $DOC

words:
  stage: test
  script:
    - grep -q "библиотеки" $DOC
EOF
git add .gitlab-ci.yml
git commit -m "Переменная DOC"
git push
glab ci view
```

В журнале каждого задания на странице CI/CD есть строка `Ветка main, коммит …` из `before_script`. Перед выводом каждой команды журнал печатает саму команду со знаком `$`.

### Когда файл не принят

Если в `.gitlab-ci.yml` ошибка, задания не выполняются. В пайплайне одно задание `Invalid workflow file`, а в журнале причина:

```text
This GitLab CI configuration is invalid: publish job: chosen stage deploys does not exist; available stages are .pre, build, test, deploy, .post
```

- `chosen stage … does not exist` — у задания `stage`, которого нет в списке `stages`: опечатка или забытая стадия;
- `config should implement the script:` — у задания нет `script`;
- `.pre` и `.post` — служебные стадии в начале и конце, писать их не нужно.

### Частые ошибки

- Файл назван `gitlab-ci.yml` или `.gitlab-ci.yaml` → GitLab его не видит. Имя строго `.gitlab-ci.yml`, в корне репозитория.
- `stage: tests`, а в `stages` написано `test` → `chosen stage tests does not exist`. Имена стадий совпадают буква в букву.
- Команды под `script:` без `- ` в начале строки → YAML склеит их в одну длинную строку, и команда упадёт. Каждая команда — отдельный элемент списка.
- Задание стадии `deploy` «не выполнилось» → посмотрите `glab ci view`: скорее всего, упало задание более ранней стадии.

### Шпаргалка

- `.gitlab-ci.yml` в корне репозитория; checkout не нужен
- `stages: [build, test, deploy]` — порядок стадий
- `задание:` → `stage: …`, `script: - команда`
- `variables: ИМЯ: значение`, в командах `$ИМЯ`
- `before_script` — команды перед каждым заданием
- `$CI_COMMIT_BRANCH`, `$CI_COMMIT_SHORT_SHA`, `$CI_PROJECT_NAME`
- упала стадия → следующие пропущены, пайплайн `failed`
- `glab ci list`, `glab ci view`, `glab ci view ID`; «Хостинг» → CI/CD

## task git-first-pipeline

```json
{
  "type": "ci",
  "title": "Первый пайплайн",
  "xp": 15,
  "hints": [
    "Перечитайте разделы «Файл .gitlab-ci.yml» и «Стадии и задания».",
    "Создайте .gitlab-ci.yml в корне проекта, наберите текст в редакторе и сохраните Ctrl+S. Два задания, у каждого своя stage и список script.",
    "Шаблон:\nstages:\n  - build\n  - test\n\npage:\n  stage: …\n  script:\n    - test -f …\n\ntitle:\n  stage: …\n  script:\n    - grep -q \"…\" index.html\nЗатем git add, git commit -m \"…\", git push."
  ]
}
```

Сайт библиотеки в `~/site` опубликован на учебном GitLab как `student/site`. В репозитории есть `index.html` и `README.md`. Терминал открыт в папке проекта.

Создайте `.gitlab-ci.yml` с двумя стадиями — `build` и `test` — и двумя заданиями:

- `page` в стадии `build` проверяет, что существует `index.html`;
- `title` в стадии `test` проверяет, что в `index.html` есть строка с `<title>`.

Закоммитьте файл и отправьте в `main`. Пайплайн на `main` должен пройти.

```sh setup
hosting flavor gitlab
mkdir site
cd site
git init -q
cat > index.html <<'EOF'
<!DOCTYPE html>
<html>
<head>
<title>Городская библиотека</title>
</head>
<body>
<h1>Городская библиотека</h1>
</body>
</html>
EOF
echo "# Сайт городской библиотеки" > README.md
git add index.html README.md
git commit -q -m "Первая версия сайта"
glab repo create site
git remote add origin https://gitlab.com/student/site.git
git push -q -u origin main
```

```sh solution
touch .gitlab-ci.yml
cat > .gitlab-ci.yml <<'EOF'
stages:
  - build
  - test

page:
  stage: build
  script:
    - test -f index.html

title:
  stage: test
  script:
    - grep -q "<title>" index.html
EOF
git add .gitlab-ci.yml
git commit -m "Пайплайн проверки сайта"
git push
glab ci view
```

## task git-pipeline-stage-typo

```json
{
  "type": "ci",
  "title": "Пайплайн не принят",
  "xp": 15,
  "hints": [
    "Раздел «Когда файл не принят».",
    "Журнал на странице CI/CD вкладки «Хостинг» называет задание и стадию. Сравните stage этого задания со списком stages.",
    "У задания publish должно быть stage: … — ровно как в списке stages. Затем git add .gitlab-ci.yml, git commit -m \"…\", git push."
  ]
}
```

В проекте `~/wiki` на учебном GitLab пайплайн из трёх стадий: `build`, `test`, `deploy`. После последнего push вместо заданий в нём одно задание `Invalid workflow file`. Терминал открыт в папке проекта.

Найдите ошибку в `.gitlab-ci.yml` (журнал — во вкладке «Хостинг» → CI/CD), исправьте её в редакторе, закоммитьте и отправьте. Задания `pages`, `links` и `publish` должны выполниться, пайплайн на `main` — пройти.

```sh setup
hosting flavor gitlab
mkdir wiki
cd wiki
git init -q
echo "# Вики команды" > index.md
echo "- [Начало работы](start.md)" >> index.md
echo "# Начало работы" > start.md
cat > .gitlab-ci.yml <<'EOF'
stages:
  - build
  - test
  - deploy

pages:
  stage: build
  script:
    - test -f index.md

links:
  stage: test
  script:
    - grep -q "start.md" index.md
    - test -f start.md

publish:
  stage: deploys
  script:
    - echo "Публикую вики"
EOF
git add index.md start.md .gitlab-ci.yml
git commit -q -m "Вики и пайплайн"
glab repo create wiki
git remote add origin https://gitlab.com/student/wiki.git
git push -q -u origin main
```

```sh solution
glab ci view
cat > .gitlab-ci.yml <<'EOF'
stages:
  - build
  - test
  - deploy

pages:
  stage: build
  script:
    - test -f index.md

links:
  stage: test
  script:
    - grep -q "start.md" index.md
    - test -f start.md

publish:
  stage: deploy
  script:
    - echo "Публикую вики"
EOF
git add .gitlab-ci.yml
git commit -m "Исправлена стадия publish"
git push
```

## task git-stage-order-review

```json
{
  "type": "review",
  "title": "Что станет с публикацией",
  "xp": 10,
  "hints": [
    "Раздел «Порядок стадий».",
    "Сначала выполняются все задания стадии test. Начнётся ли deploy, если одно из них упало?"
  ],
  "options": [
    "Выполнятся все три задания: стадии независимы",
    "unit пройдёт, lint упадёт, publish будет пропущен, пайплайн — failed",
    "publish выполнится, но пайплайн будет помечен как failed",
    "Пайплайн не запустится: файл с ошибкой"
  ],
  "answer": [1],
  "explanation": "Задания стадии `test` выполняются оба: `unit` проходит, `lint` падает, потому что в README нет слова «Лицензия». Стадия `deploy` начинается только когда все задания предыдущей стадии прошли, поэтому `publish` пропущен, а пайплайн получает `failed`. Стадии не независимы, а файл корректен: все `stage` есть в списке `stages`."
}
```

В репозитории есть `README.md` со строкой `# Калькулятор` и файл `calc.js`. Слова «Лицензия» в README нет. Что покажет `glab ci view` после push в `main`?

```yaml code
stages:
  - test
  - deploy

unit:
  stage: test
  script:
    - test -f calc.js

lint:
  stage: test
  script:
    - grep -q "Лицензия" README.md

publish:
  stage: deploy
  script:
    - echo "Публикую"
```

## task git-pipeline-variables

```json
{
  "type": "ci",
  "title": "Забытая переменная",
  "xp": 20,
  "hints": [
    "Раздел «variables и before_script».",
    "Задание check использует $PAGE, но переменная нигде не объявлена — команда получает пустую строку вместо имени файла. Добавьте раздел variables на верхнем уровне файла.",
    "В начало файла:\nvariables:\n  PAGE: …\nЗатем git add, git commit -m \"…\", git push."
  ]
}
```

В проекте `~/promo` на учебном GitLab задание `check` должно проверять страницу акции: `grep -q "<title>" $PAGE`. Коллега вынес имя файла в переменную `PAGE`, но забыл её объявить, и пайплайн на `main` падает. Терминал открыт в папке проекта.

Объявите в `.gitlab-ci.yml` переменную `PAGE` со значением `sale.html` для всех заданий, закоммитьте и отправьте изменение. Задание `check` менять не нужно. Пайплайн на `main` должен пройти.

```sh setup
hosting flavor gitlab
mkdir promo
cd promo
git init -q
cat > sale.html <<'EOF'
<html>
<head>
<title>Скидки недели</title>
</head>
<body>
<h1>Скидки недели</h1>
</body>
</html>
EOF
cat > .gitlab-ci.yml <<'EOF'
before_script:
  - echo "Проверяю ветку $CI_COMMIT_BRANCH"

check:
  stage: test
  script:
    - grep -q "<title>" $PAGE
EOF
git add sale.html .gitlab-ci.yml
git commit -q -m "Страница акции"
glab repo create promo
git remote add origin https://gitlab.com/student/promo.git
git push -q -u origin main
```

```sh solution
cat > .gitlab-ci.yml <<'EOF'
variables:
  PAGE: sale.html

before_script:
  - echo "Проверяю ветку $CI_COMMIT_BRANCH"

check:
  stage: test
  script:
    - grep -q "<title>" $PAGE
EOF
git add .gitlab-ci.yml
git commit -m "Объявлена переменная PAGE"
git push
```
