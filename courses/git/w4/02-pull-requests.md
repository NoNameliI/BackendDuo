# Pull request на GitHub

В команде код редко попадает в `main` напрямую. Вы делаете ветку, отправляете её на GitHub и просите коллег посмотреть изменения — открываете **pull request** (PR). Коллега читает код, одобряет, и только тогда ветку сливают. Так ошибки ловят до того, как они попадут к пользователям. В этом уроке вы опубликуете репозиторий, откроете PR, проведёте ревью, сольёте его и закроете задачу.

### Учебный хостинг

В песочнице работает учебная модель GitHub. Она живёт внутри приложения: настоящих аккаунтов, паролей и токенов здесь нет, вводить их не нужно и не следует. Вы всегда работаете как пользователь `student`, коллег изображает песочница.

С хостингом работают двумя способами:

- вкладка **«Хостинг»** справа — страницы проекта: код и ветки, pull requests, задачи (Issues), релизы, настройки;
- команда `gh` в терминале — учебная версия консольного клиента GitHub. Входить в неё не нужно.

Адрес проекта выглядит как `https://github.com/владелец/имя`. Его можно использовать как адрес удалённого репозитория: `git clone`, `git push` и `git pull` работают с ним так же, как с `/srv/…` из прошлого урока.

### gh repo create — опубликовать репозиторий

```sh
gh repo create имя --public --source=. --push
```

- `repo create` — создать репозиторий на хостинге (`student/имя`);
- `имя` — имя репозитория, обычно как у папки;
- `--public` — публичный репозиторий, его видят все; `--private` — закрытый. Без одного из этих флагов `gh` не создаст репозиторий;
- `--source=.` — связать его с репозиторием в текущей папке: команда добавит удалённый `origin`;
- `--push` — сразу отправить текущую ветку (как `git push -u origin ветка`).

```sh example
cd ~
mkdir recipes
cd recipes
git init
echo "# Рецепты" > README.md
git add README.md
git commit -m "Описание проекта"
gh repo create recipes --public --source=. --push
git remote -v
```

Откройте вкладку «Хостинг»: там появился проект `student/recipes` с веткой `main`.

### Pull request

Pull request — запрос «влейте мою ветку в `main`». Он хранится на хостинге, у него есть номер (`#1`), заголовок, описание, обсуждение и ревью. Путь всегда один:

1. ветка: `git switch -c имя`, коммиты;
2. отправка: `git push -u origin имя`;
3. PR: `gh pr create`;
4. ревью и слияние на хостинге;
5. обновление своего `main`: `git pull`.

### gh pr create — открыть pull request

```sh
gh pr create --title "Заголовок" --body "Описание"
gh pr create --fill
```

- `pr create` — открыть PR из текущей ветки;
- `--title` — заголовок: что сделано;
- `--body` — описание: зачем и как проверить; необязательно;
- `--fill` — взять заголовок из сообщения последнего коммита;
- по умолчанию PR открывается в основную ветку (`main`).

Ветку нужно сначала отправить: PR сравнивает ветки на хостинге, а не у вас.

```sh example
git switch -c soup
echo "Борщ: свёкла, капуста, картофель" > soup.md
git add soup.md
git commit -m "Рецепт борща"
git push -u origin soup
gh pr create --title "Рецепт борща" --body "Первый суп в коллекции"
```

При первой отправке ветки хостинг сам подсказывает адрес, по которому можно открыть PR.

### gh pr list и gh pr view

```sh
gh pr list
gh pr view номер
```

- `pr list` — открытые PR проекта: номер, заголовок, ветка;
- `pr view` — подробности: автор, сколько коммитов, ревью, описание и можно ли сливать. Без номера показывает PR текущей ветки.

```sh example
gh pr list
gh pr view 1
```

Последняя строка `Можно сливать.` значит, что препятствий нет. Иначе будет `Слить пока нельзя:` и причина.

### Ревью

**Ревью** — проверка PR коллегой. Итог ревью — одобрение или просьба изменить.

```sh
gh pr review номер --approve
gh pr review номер --request-changes --body "Что исправить"
```

- `pr review` — оставить ревью на PR с этим номером;
- `--approve` — одобрить;
- `--request-changes` — попросить изменений; `--body` — комментарий, что именно;
- `--comment --body "Текст"` — просто прокомментировать, без вердикта.

Прокомментировать можно и свой PR:

```sh example
gh pr review 1 --comment --body "Проверю пропорции завтра"
gh pr view 1
```

Одобрять свой собственный PR нельзя — так же, как на настоящем GitHub:

```
$ gh pr review 1 --approve
Can not approve your own pull request
```

Свой PR отдают на ревью коллеге. В песочнице для этого есть кнопка **«Попросить ревью у наставника»** на странице PR во вкладке «Хостинг»: наставник посмотрит изменения и одобрит их или попросит исправить. Если просят исправить, сделайте новый коммит в той же ветке и `git push` — PR обновится сам.

### gh pr merge — слить

```sh
gh pr merge номер --merge
gh pr merge номер --squash --delete-branch
```

- `pr merge` — слить PR на хостинге; без номера — PR текущей ветки;
- способ слияния — один из трёх:
  - `--merge` — коммит слияния, все коммиты ветки сохраняются. Способ указывайте всегда: настоящий `gh` без флага спрашивает его в диалоге, а в скрипте завершается ошибкой (песочница без флага делает обычное слияние);
  - `--squash` — все коммиты ветки склеиваются в один новый коммит в `main`;
  - `--rebase` — коммиты ветки переносятся поверх `main` по одному, без коммита слияния;
- `--delete-branch` — после слияния удалить ветку на хостинге.

```sh example
gh pr merge 1 --squash --delete-branch
```

### Задачи (issues)

**Задача** (issue) — запись об ошибке или идее на хостинге: заголовок, описание, номер, состояние «открыта» или «закрыта».

```sh
gh issue create --title "Заголовок" --body "Описание"
gh issue list
```

- `issue create` — завести задачу; `--title` обязателен, `--body` — нет;
- `issue list` — открытые задачи; `--state all` — все.

На GitHub у задач и PR **общая нумерация**: если в проекте уже есть PR `#1`, новая задача получит `#2`.

Задачу удобно закрывать тем PR, который её решает: напишите в описании PR `Closes #номер`. Когда PR сольют, задача закроется сама.

```sh example
gh issue create --title "Добавить десерты" --body "Нужен хотя бы один рецепт"
```

### После слияния: обновить main

Слияние произошло на хостинге, а ваш локальный `main` об этом не знает. Переключитесь на него и заберите изменения.

```sh
git switch main
git pull
```

Продолжим пример: решим задачу `#2` новым PR и обновим `main`.

```sh example
git switch main
git pull
git switch -c cake
echo "Шарлотка: яблоки, мука, яйца" > cake.md
git add cake.md
git commit -m "Рецепт шарлотки"
git push -u origin cake
gh pr create --fill --body "Closes #2"
gh pr merge --merge --delete-branch
gh issue list --state all
git switch main
git pull
git log --oneline
```

### Частые ошибки

- `gh pr create` до `git push` → `you must first push the current branch`. Сначала `git push -u origin ветка`.
- `gh pr review` своего PR → `Can not approve your own pull request`. Попросите ревью у коллеги (кнопка «Попросить ревью у наставника»).
- После слияния продолжать работу в старой ветке → в ней нет чужих изменений. `git switch main`, `git pull`, новая ветка.
- `Closes 2` без решётки → задача не закроется. Пишите `Closes #номер` в описании PR.

### Шпаргалка

- `gh repo create имя --public --source=. --push` — опубликовать текущий репозиторий
- `git push -u origin ветка`, затем `gh pr create --title "…" --body "…"` или `--fill`
- `gh pr list`, `gh pr view номер` — список и подробности
- `gh pr review номер --approve` — одобрить чужой PR
- `gh pr merge номер [--merge | --squash | --rebase] [--delete-branch]`
- `gh issue create --title "…"`, `gh issue list`; `Closes #номер` в описании PR
- после слияния: `git switch main`, `git pull`

## task git-gh-repo-create

```json
{
  "type": "hosting",
  "title": "Опубликовать проект",
  "xp": 10,
  "hints": [
    "Раздел «gh repo create — опубликовать репозиторий».",
    "Одна команда создаёт репозиторий на хостинге, добавляет origin и отправляет ветку.",
    "gh repo create … --public --source=. --push"
  ]
}
```

В папке `~/portfolio` есть репозиторий с двумя коммитами. Терминал открыт в этой папке.

Опубликуйте его на учебном GitHub под именем `portfolio` и сразу отправьте туда ветку `main`.

```sh setup
mkdir portfolio
cd portfolio
git init -q
echo "# Портфолио" > README.md
git add README.md
git commit -q -m "Описание"
echo "<h1>Мои работы</h1>" > index.html
git add index.html
git commit -q -m "Главная страница"
```

```sh solution
gh repo create portfolio --public --source=. --push
```

## task git-gh-pr-create

```json
{
  "type": "hosting",
  "title": "Первый pull request",
  "xp": 10,
  "hints": [
    "Раздел «gh pr create — открыть pull request».",
    "Ветки contacts на хостинге ещё нет: сначала отправьте её с -u, потом откройте PR.",
    "git push -u origin …, затем gh pr create --title \"…\""
  ],
  "check": {
    "titles": true
  }
}
```

Репозиторий `~/site` уже опубликован как `student/site`. Вы на ветке `contacts`: в ней есть коммит со страницей контактов, но на хостинг ветка ещё не отправлена.

Отправьте ветку `contacts` и откройте pull request из неё в `main` с заголовком **Страница контактов**.

```sh setup
mkdir site
cd site
git init -q
echo "<h1>Кофейня</h1>" > index.html
git add index.html
git commit -q -m "Главная"
gh repo create site --public --source=. --push
git switch -q -c contacts
echo "<p>Телефон: 123-45-67</p>" > contacts.html
git add contacts.html
git commit -q -m "Страница контактов"
```

```sh solution
git push -u origin contacts
gh pr create --title "Страница контактов" --body "Телефон кофейни"
```

## task git-gh-review-rebase

```json
{
  "type": "hosting",
  "title": "Ревью чужого PR",
  "xp": 15,
  "hints": [
    "Разделы «Ревью» и «gh pr merge — слить».",
    "Сначала посмотрите PR (gh pr view 1), затем одобрите его. Коммиты нужно перенести без коммита слияния — это способ --rebase.",
    "gh pr review 1 --…, затем gh pr merge 1 --… --delete-branch"
  ]
}
```

Коллега Анна открыла в проекте `student/site` pull request `#1` «Страница меню» из ветки `menu`. В нём два коммита. Терминал открыт в `~/site`.

Проведите ревью: одобрите PR. Затем слейте его так, чтобы оба коммита Анны легли в `main` по отдельности, без коммита слияния, и удалите ветку `menu` на хостинге.

```sh setup
mkdir site
cd site
git init -q
echo "<h1>Кофейня</h1>" > index.html
git add index.html
git commit -q -m "Главная"
gh repo create site --public --source=. --push
git clone -q https://github.com/student/site.git /tmp/anna
cd /tmp/anna
git switch -q -c menu
echo "<p>Капучино</p>" > menu.html
git add menu.html
as anna git commit -q -m "Страница меню"
echo "<p>Капучино — 250 ₽</p>" > menu.html
git add menu.html
as anna git commit -q -m "Цены в меню"
as anna git push -q -u origin menu
as anna gh pr create --title "Страница меню" --body "Меню с ценами"
cd ~/site
```

```sh solution
gh pr view 1
gh pr review 1 --approve
gh pr merge 1 --rebase --delete-branch
git pull
```

## task git-gh-issue-closes

```json
{
  "type": "hosting",
  "title": "Закрыть задачу через PR",
  "xp": 20,
  "hints": [
    "Разделы «Задачи (issues)» и «Pull request».",
    "Путь: ветка → коммит → git push -u → gh pr create с Closes #1 в описании → gh pr merge. Задача закроется сама при слиянии.",
    "git switch -c …, правка README.md, git add и git commit -m \"…\", git push -u origin …, затем gh pr create --title \"…\" --body \"Closes #…\" и gh pr merge --… --delete-branch."
  ]
}
```

В проекте `student/blog` наставник завёл задачу `#1` «Опечатка в README». Терминал открыт в `~/blog` на ветке `main`.

1. Создайте ветку `fix-typo` и замените содержимое `README.md` одной строкой `# Блог о путешествиях`. Сделайте коммит.
2. Отправьте ветку и откройте pull request в `main`, который при слиянии закроет задачу `#1`.
3. Слейте PR обычным слиянием (с коммитом слияния) и удалите ветку на хостинге.

```sh setup
mkdir blog
cd blog
git init -q
echo "# Блог о путешествях" > README.md
git add README.md
git commit -q -m "Описание блога"
gh repo create blog --public --source=. --push
as mentor gh issue create --title "Опечатка в README" --body "В слове «путешествиях» пропущена буква"
```

```sh solution
git switch -c fix-typo
echo "# Блог о путешествиях" > README.md
git add README.md
git commit -m "Исправлена опечатка в README"
git push -u origin fix-typo
gh pr create --title "Исправлена опечатка" --body "Closes #1"
gh pr merge --merge --delete-branch
git switch main
git pull
```
