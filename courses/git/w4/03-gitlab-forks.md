# GitLab и форки

Многие компании держат код не на GitHub, а на GitLab. Идеи там те же: ветка, запрос на слияние, ревью. Отличаются слова и команды. А в открытых проектах вам обычно не дают писать в чужой репозиторий: вы делаете свою копию — **форк** — и предлагаете изменения оттуда. В этом уроке вы откроете merge request на GitLab, сделаете форк, отправите из него pull request и научитесь подтягивать в форк свежие изменения оригинала.

Хостинг по-прежнему учебный: GitHub и GitLab здесь — модель внутри приложения, без аккаунтов, паролей и токенов.

### GitHub и GitLab: одни идеи, разные слова

| GitHub | GitLab | Что это |
|---|---|---|
| pull request, `#5` | merge request (MR), `!5` | запрос на слияние ветки |
| `gh` | `glab` | консольный клиент |
| Actions | CI/CD | автоматические проверки |
| approve | approve | одобрение ревьюера |
| issue `#3` | issue `#3` | задача |

Ещё одно отличие: на GitHub задачи и PR нумеруются вместе, а на GitLab у merge request и у задач свои счётчики — может быть и `!1`, и `#1`.

Во вкладке «Хостинг» слева вверху есть переключатель **GitHub / GitLab**. Он меняет термины, адреса (`https://gitlab.com/…`) и сообщения хостинга. Команды клиента должны совпадать с режимом: в режиме GitLab `gh` ответит `используйте glab`, и наоборот. В заданиях нужный режим уже выбран.

### glab mr create — открыть merge request

Ветку отправляют так же: `git push -u origin ветка`. Затем:

```sh
glab mr create --title "Заголовок" --description "Описание"
glab mr create --fill
```

- `mr create` — открыть merge request из текущей ветки в основную;
- `--title` — заголовок; `--description` — описание (на GitHub это `--body`);
- `--fill` — взять заголовок из последнего коммита.

```sh example
git remote -v
git switch -c faq
echo "Вопросы и ответы" > faq.md
git add faq.md
git commit -m "Раздел FAQ"
git push -u origin faq
glab mr create --fill --description "Новый раздел документации"
```

После `git push` GitLab подсказывает ссылку для создания MR — так выглядит и настоящий GitLab.

### glab mr list, view, approve, merge

```sh
glab mr list
glab mr view номер
glab mr approve номер
glab mr merge номер --squash --remove-source-branch
```

- `mr list` — открытые merge request в формате `!номер  заголовок  (main) ← (ветка)`;
- `mr view` — подробности и строка «можно ли сливать»;
- `mr approve` — одобрить чужой MR (свой одобрить нельзя, как и на GitHub);
- `mr merge` — слить; `--squash` склеит коммиты в один, `--remove-source-branch` удалит ветку (аналог `--delete-branch`).

```sh example
glab mr list
glab mr view 1
glab mr merge 1 --squash --remove-source-branch
```

Кнопка «Попросить ревью у наставника» во вкладке «Хостинг» работает и в режиме GitLab.

### Форк

**Форк** — ваша копия чужого репозитория на хостинге: `mentor/handbook` → `student/handbook`. В форк вы можете отправлять что угодно, оригинал от этого не меняется. Чтобы предложить изменения автору, вы открываете pull request **из ветки форка в оригинал**.

У локальной копии форка два удалённых:

- `origin` — ваш форк, сюда вы делаете `git push`;
- `upstream` — оригинал, отсюда вы забираете новые коммиты.

### gh repo fork — сделать форк

```sh
gh repo fork владелец/имя --clone
```

- `repo fork` — создать форк репозитория `владелец/имя` в вашем аккаунте;
- `--clone` — сразу склонировать форк в папку `имя` и добавить удалённый `upstream` с адресом оригинала.

В режиме GitLab команда та же, только начинается с `glab`: `glab repo fork владелец/имя --clone`. Пример ниже идёт в режиме GitLab.

```sh example
cd ~
glab repo fork mentor/handbook --clone
cd handbook
git remote -v
```

`git remote -v` показывает оба удалённых: `origin` указывает на `student/handbook`, `upstream` — на `mentor/handbook`.

### Pull request из форка

Ветку отправляют в свой форк, а `gh pr create` (или `glab mr create`) сам понимает, что репозиторий — форк, и открывает запрос в оригинал.

```sh
git push -u origin ветка
gh pr create --title "Заголовок"
```

- `git push -u origin ветка` — ветка уходит в ваш форк, не в оригинал;
- `gh pr create` — открывает PR в репозитории-родителе; в нём видно `student:ветка` — ветку из вашего форка.

```sh example
git switch -c tips
echo "Делайте маленькие коммиты" > tips.md
git add tips.md
git commit -m "Советы новичку"
git push -u origin tips
glab mr create --title "Советы новичку"
```

В выводе: `Creating merge request for student:tips into main in mentor/handbook`.

### Обновить форк: upstream

Пока вы работаете, автор оригинала добавляет коммиты. Сам форк их не получает — подтягивать их нужно вручную.

```sh
git switch main
git fetch upstream
git merge upstream/main
git push
```

- `git fetch upstream` — скачать новые коммиты оригинала; появится ветка наблюдения `upstream/main`;
- `git merge upstream/main` — влить их в свой `main`; если своих коммитов в `main` нет, это перемотка вперёд;
- `git push` — отправить обновлённый `main` в свой форк (`origin`).

```sh example
git switch main
git fetch upstream
git merge upstream/main
git push
git branch -a
```

Здесь оригинал ещё не менялся, поэтому `merge` ответит `Already up to date.`, а `push` — `Everything up-to-date`. Когда в оригинале есть новое, вывод похож на прошлый урок:

```
$ git merge upstream/main
Updating …
Fast-forward
 rules.md | 1 +
```

### Частые ошибки

- `gh` в режиме GitLab → `Учебный хостинг сейчас в режиме GitLab: используйте glab`. Берите клиент по режиму.
- `git push upstream ветка` → в чужой репозиторий так не пишут. Отправляйте в свой форк: `git push -u origin ветка`.
- Обновлять форк через `git pull` без указания `upstream` → `git pull` заберёт изменения вашего же форка. Для оригинала: `git fetch upstream` и `git merge upstream/main`.
- Обновить локальный `main` и забыть `git push` → форк на хостинге остаётся старым.

### Шпаргалка

- GitHub `pull request #N` ↔ GitLab `merge request !N`; `gh` ↔ `glab`
- `glab mr create --title "…" --description "…"` или `--fill`
- `glab mr list`, `glab mr view N`, `glab mr approve N`, `glab mr merge N [--squash] [--remove-source-branch]`
- `gh repo fork владелец/имя --clone` — форк, клон и `upstream`
- PR из форка: `git push -u origin ветка`, `gh pr create --title "…"`
- обновить форк: `git fetch upstream`, `git merge upstream/main`, `git push`

## task git-glab-mr-create

```json
{
  "type": "hosting",
  "title": "Merge request на GitLab",
  "xp": 10,
  "hints": [
    "Раздел «glab mr create — открыть merge request».",
    "Создайте ветку, сделайте коммит, отправьте ветку с -u и откройте MR. Хостинг в режиме GitLab, поэтому клиент — glab.",
    "git switch -c install, echo \"…\" > install.md, git add …, git commit -m \"…\", git push -u origin install, glab mr create --title \"…\""
  ]
}
```

Проект `student/docs` живёт на учебном GitLab, его копия — в `~/docs`, вы на ветке `main`.

1. Создайте ветку `install` и в ней файл `install.md` с одной строкой `Установка: скачайте архив и распакуйте`. Сделайте коммит.
2. Отправьте ветку на хостинг и откройте merge request в `main` с заголовком **Инструкция по установке**.

```sh setup
hosting flavor gitlab
mkdir /tmp/docs
cd /tmp/docs
git init -q
echo "# Документация" > README.md
git add README.md
git commit -q -m "Описание"
hosting create student/docs --from /tmp/docs
mkdir /tmp/handbook
cd /tmp/handbook
git init -q
echo "# Справочник новичка" > README.md
git add README.md
as mentor git commit -q -m "Справочник"
hosting create mentor/handbook --from /tmp/handbook
cd ~
git clone -q https://gitlab.com/student/docs.git
cd docs
```

```sh solution
git switch -c install
echo "Установка: скачайте архив и распакуйте" > install.md
git add install.md
git commit -m "Инструкция по установке"
git push -u origin install
glab mr create --title "Инструкция по установке"
```

## task git-fork-pr

```json
{
  "type": "hosting",
  "title": "Pull request из форка",
  "xp": 15,
  "hints": [
    "Разделы «gh repo fork — сделать форк» и «Pull request из форка».",
    "После gh repo fork … --clone перейдите в папку cookbook. Ветку отправляйте в origin — это ваш форк; PR сам уйдёт в оригинал.",
    "gh repo fork mentor/cookbook --clone, cd cookbook, git switch -c pancakes, echo \"…\" > pancakes.md, git add, git commit -m \"…\", git push -u origin pancakes, gh pr create --title \"…\""
  ]
}
```

Наставник ведёт открытый проект `mentor/cookbook` на учебном GitHub. Писать в него напрямую вы не можете. Терминал открыт в домашней папке.

1. Сделайте форк `mentor/cookbook` и склонируйте его.
2. В клоне создайте ветку `pancakes` с файлом `pancakes.md`, в котором одна строка `Блины: мука, молоко, яйца`. Сделайте коммит.
3. Отправьте ветку в свой форк и откройте pull request в оригинальный репозиторий с заголовком **Рецепт блинов**.

```sh setup
mkdir /tmp/book
cd /tmp/book
git init -q
echo "# Кулинарная книга" > README.md
git add README.md
as mentor git commit -q -m "Описание книги"
hosting create mentor/cookbook --from /tmp/book
cd ~
```

```sh solution
gh repo fork mentor/cookbook --clone
cd cookbook
git switch -c pancakes
echo "Блины: мука, молоко, яйца" > pancakes.md
git add pancakes.md
git commit -m "Рецепт блинов"
git push -u origin pancakes
gh pr create --title "Рецепт блинов" --body "Классический рецепт"
```

## task git-fork-sync

```json
{
  "type": "graph",
  "title": "Обновить форк",
  "xp": 15,
  "hints": [
    "Раздел «Обновить форк: upstream».",
    "Три шага: скачать коммиты оригинала, влить upstream/main в свой main, отправить main в свой форк.",
    "git fetch upstream, git merge …, git push"
  ],
  "check": { "remotes": true }
}
```

В `~/cookbook` лежит клон вашего форка `student/cookbook`, оригинал подключён как `upstream`. С тех пор наставник добавил в `mentor/cookbook` два рецепта.

Подтяните эти коммиты в свой `main` и обновите форк на хостинге: в итоге `main`, `origin/main` и `upstream/main` должны указывать на один и тот же коммит, без коммита слияния.

```sh setup
mkdir /tmp/book
cd /tmp/book
git init -q
echo "# Кулинарная книга" > README.md
git add README.md
as mentor git commit -q -m "Описание книги"
hosting create mentor/cookbook --from /tmp/book
cd ~
gh repo fork mentor/cookbook --clone
git clone -q https://github.com/mentor/cookbook.git /tmp/mentor
cd /tmp/mentor
echo "Омлет: яйца, молоко" > omelet.md
git add omelet.md
as mentor git commit -q -m "Рецепт омлета"
echo "Каша: овсянка, молоко" > porridge.md
git add porridge.md
as mentor git commit -q -m "Рецепт каши"
as mentor git push -q
cd ~/cookbook
```

```sh solution
git fetch upstream
git merge upstream/main
git push
```

## task git-gitlab-terms

```json
{
  "type": "choice",
  "title": "Язык GitLab",
  "xp": 10,
  "hints": [
    "Раздел «GitHub и GitLab: одни идеи, разные слова».",
    "На GitLab восклицательный знак стоит перед номером merge request, решётка — перед номером задачи."
  ],
  "options": [
    "Merge request номер 12 — запрос на слияние ветки",
    "Задачу (issue) номер 12",
    "Двенадцатый коммит в истории",
    "Пайплайн CI/CD номер 12"
  ],
  "answer": [0],
  "explanation": "На GitLab запрос на слияние называется merge request и обозначается `!номер` — это аналог pull request `#номер` на GitHub. Задачи на GitLab пишутся через решётку (`#12`), у коммитов вместо номеров идентификаторы, а пайплайны CI/CD ищут на отдельной странице, а не по `!`."
}
```

Коллега пишет в чате команды на GitLab: «Глянь, пожалуйста, `!12`, я поправил замечания». О чём речь?
