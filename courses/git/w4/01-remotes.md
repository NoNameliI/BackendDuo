# Удалённые репозитории

Пока репозиторий живёт только на вашем компьютере, коллеги не видят ваших коммитов, а вы — их. Команды договариваются об общем репозитории на сервере: каждый забирает оттуда чужую работу и отправляет туда свою. В этом уроке вы склонируете репозиторий с сервера, отправите на него коммиты, заберёте чужие и разберёте самый частый отказ при отправке.

В песочнице «сервер» — это папка `/srv/…` внутри учебной модели, сети нет. Позже тот же адрес будет вести на учебный хостинг: `https://github.com/…`.

### Удалённый репозиторий

**Удалённый репозиторий** (remote) — копия проекта в другом месте: на сервере, на GitHub или GitLab. У вашего репозитория может быть несколько удалённых, у каждого — короткое имя и адрес. Основной по традиции называется `origin`.

На сервере лежит «голый» репозиторий: в нём есть история, но нет рабочей папки — правят файлы не там, а в своих копиях. Поэтому его имя обычно кончается на `.git`: `/srv/shop.git`.

Обмен идёт всегда по вашей команде:

- `git clone` — скопировать удалённый репозиторий целиком;
- `git push` — отправить свои коммиты;
- `git fetch` — скачать чужие коммиты, ничего не меняя в ваших файлах;
- `git pull` — скачать и сразу влить в текущую ветку.

### git clone — скопировать репозиторий

```sh
git clone адрес папка
```

- `clone` — создать папку, скачать в неё всю историю и переключиться на основную ветку;
- `адрес` — путь или URL удалённого репозитория;
- `папка` — необязательна: без неё Git возьмёт имя из адреса без `.git` (`/srv/shop.git` → `shop`).

Клон сразу знает, откуда он взят: удалённый репозиторий записан под именем `origin`. Список удалённых показывает `git remote -v`: имя, адрес и направление — `fetch` (откуда забирать) и `push` (куда отправлять).

```sh example
git clone /srv/shop.git demo
cd demo
git remote -v
```

### Ветки наблюдения: origin/main

После клонирования у вас есть обычная ветка `main` и **ветка наблюдения** `origin/main` — запомненное положение ветки `main` на сервере. Сами вы её не двигаете: она обновляется при `git fetch`, `git pull` и `git push`.

- `git branch -a` — все ветки, включая удалённые (`remotes/origin/main`);
- `git log --oneline --all` — история всех веток; рядом с коммитом видно, где сейчас `main`, а где `origin/main`.

```sh example
git branch -a
git log --oneline --all
```

Сравнивая `main` и `origin/main`, Git пишет в `git status`: `Your branch is ahead of 'origin/main' by 1 commit` (у вас есть неотправленные коммиты) или `behind` (на сервере есть то, чего нет у вас).

### git push — отправить коммиты

```sh
git push -u origin ветка
git push
```

- `push` — отправить коммиты ветки на сервер;
- `origin` — куда отправлять;
- `ветка` — какую ветку; на сервере появится ветка с тем же именем;
- `-u` — запомнить связь «моя ветка ↔ ветка на сервере». Её достаточно указать при первой отправке ветки, дальше хватает короткого `git push`.

Ветка `main` в клоне уже связана с `origin/main`, поэтому для неё сразу работает `git push`.

```sh example
echo "Скидки по пятницам" > sale.md
git add sale.md
git commit -m "Акция выходного дня"
git status
git push
```

Новую ветку отправляем с `-u`:

```sh example
git switch -c promo
echo "Промокод WELCOME" > promo.md
git add promo.md
git commit -m "Промокод"
git push -u origin promo
```

Строка `branch 'promo' set up to track 'origin/promo'` означает, что связь запомнена.

### git remote add — подключить удалённый

Если репозиторий создан у вас командой `git init`, удалённого у него нет. Его подключают вручную.

```sh
git remote add имя адрес
```

- `remote add` — добавить удалённый репозиторий;
- `имя` — как вы будете его называть; для основного сервера — `origin`;
- `адрес` — путь или URL.

```sh example
git remote add backup /srv/backup.git
git remote -v
git push backup main
```

Здесь мы подключили второй сервер `backup` и отправили на него `main`. Для основного сервера команды те же, только имя `origin`, а первую отправку делают с `-u`.

### git fetch — узнать, что нового

```sh
git fetch
git fetch имя
```

- `fetch` — скачать с сервера новые коммиты и сдвинуть ветки наблюдения (`origin/main`);
- `имя` — необязательно, по умолчанию `origin`.

Ваши ветки и файлы `fetch` не трогает. Это безопасный способ посмотреть, что сделали коллеги.

Чтобы увидеть чужие коммиты, сыграем за коллегу: склонируем тот же сервер во вторую папку, сделаем там коммит и отправим его.

```sh example
cd ~
git clone /srv/shop.git colleague
cd colleague
echo "Кофе — 450 ₽" >> prices.txt
git add prices.txt
git commit -m "Кофе в прайсе"
git push
```

Вернёмся в свою копию и посмотрим, что изменилось:

```sh example
cd ~/demo
git switch main
git fetch
git status
git log --oneline --all
```

`origin/main` ушла вперёд, а `main` осталась на месте: `git status` пишет `behind`.

### git pull — забрать и слить

```sh
git pull
```

- `pull` — это `git fetch` и сразу слияние ветки наблюдения в текущую ветку (`origin/main` → `main`).

Если своих новых коммитов у вас нет, слияние — просто перемотка вперёд (`Fast-forward`). Если есть, в песочнице Git создаст коммит слияния, как `git merge` из прошлых уроков. Настоящий Git в таком случае сначала попросит выбрать способ объединения; чтобы он вёл себя так же, один раз выполните на своём компьютере `git config --global pull.rebase false` — в песочнице эта настройка уже включена. При конфликте разрешайте его так же: правка файла, `git add`, `git commit`.

```sh example
git pull
git log --oneline
```

### Отклонённый push: fetch first

Вы сделали коммит, а коллега успел отправить свой раньше. Тогда сервер откажет:

```
$ git push
 ! [rejected]        main -> main (fetch first)
error: failed to push some refs to '/srv/shop.git'
hint: Updates were rejected because the remote contains work that you do not
hint: have locally.
```

Сервер не принимает push, который потеряет чужие коммиты. Порядок действий:

1. `git pull` — забрать чужие коммиты; Git сольёт их с вашими.
2. `git push` — теперь история на сервере продолжается вашей, ничего не теряется.

### Частые ошибки

- `git push` новой ветки без `-u` → `has no upstream branch`. Первый раз: `git push -u origin ветка`.
- Повторять `git push` после отказа `fetch first` → отказ не исчезнет. Сначала `git pull`, потом `git push`.
- Ждать изменений в файлах после `git fetch` → он обновляет только `origin/main`. Чтобы влить коммиты в свою ветку, нужен `git pull`.
- `git clone` внутри другого репозитория → получится репозиторий в репозитории. Перед клонированием перейдите в нужную папку: `cd ~`.

### Шпаргалка

- `git clone адрес [папка]` — скопировать удалённый репозиторий
- `git remote -v` — список удалённых; `git remote add имя адрес` — подключить
- `git push -u origin ветка` — первая отправка ветки; дальше `git push`
- `git fetch` — скачать новое, обновить `origin/…`, файлы не трогать
- `git pull` — скачать и слить в текущую ветку
- `git branch -a`, `git log --oneline --all` — ветки наблюдения
- отказ `fetch first` → `git pull`, затем `git push`

## task git-clone-push

```json
{
  "type": "graph",
  "title": "Склонировать и отправить",
  "xp": 10,
  "hints": [
    "Разделы «git clone — скопировать репозиторий» и «git push — отправить коммиты».",
    "После клонирования перейдите в папку shop. Ветка main в клоне уже связана с сервером, поэтому хватит короткого git push.",
    "git clone /srv/shop.git, cd shop, echo \"…\" > delivery.md, git add …, git commit -m \"…\", git push."
  ],
  "check": { "repo": "~/shop", "remotes": true }
}
```

На сервере лежит репозиторий интернет-магазина `/srv/shop.git`. Терминал открыт в домашней папке.

1. Склонируйте репозиторий в папку `shop` (её имя Git возьмёт из адреса).
2. Создайте в ней файл `delivery.md` с одной строкой `Доставка за три дня`.
3. Сохраните его коммитом с сообщением **Условия доставки** и отправьте коммит на сервер.

```sh setup
git init -q --bare /srv/shop.git
git init -q --bare /srv/backup.git
git clone -q /srv/shop.git /tmp/team
cd /tmp/team
echo "# Магазин чая" > README.md
git add README.md
as anna git commit -q -m "Описание магазина"
echo "Чай — 300 ₽" > prices.txt
git add prices.txt
as anna git commit -q -m "Цены"
git push -q
cd ~
```

```sh solution
git clone /srv/shop.git
cd shop
echo "Доставка за три дня" > delivery.md
git add delivery.md
git commit -m "Условия доставки"
git push
```

## task git-remote-add-push

```json
{
  "type": "graph",
  "title": "Подключить сервер",
  "xp": 10,
  "hints": [
    "Разделы «git remote add — подключить удалённый» и «git push — отправить коммиты».",
    "Сначала добавьте удалённый репозиторий с именем origin, затем отправьте main с флагом -u.",
    "git remote add origin …, затем git push -u origin …."
  ],
  "check": {
    "remotes": true,
    "upstreams": true
  }
}
```

Репозиторий `~/notes` с заметками пока есть только у вас: удалённых у него нет. На сервере для него создан пустой репозиторий `/srv/notes.git`.

Подключите сервер под именем `origin` и отправьте на него ветку `main` так, чтобы она запомнила связь с `origin/main`.

```sh setup
git init -q --bare /srv/notes.git
mkdir notes
cd notes
git init -q
echo "Прочитать книгу о Git" > todo.txt
git add todo.txt
git commit -q -m "Список дел"
echo "Встреча в 15:00" > meetings.txt
git add meetings.txt
git commit -q -m "Встречи"
```

```sh solution
git remote add origin /srv/notes.git
git push -u origin main
```

## task git-pull-before-push

```json
{
  "type": "graph",
  "title": "Сервер ушёл вперёд",
  "xp": 15,
  "hints": [
    "Раздел «Отклонённый push: fetch first».",
    "Сервер отказывает, потому что на нём есть чужой коммит. Заберите его и слейте со своим, затем отправьте снова.",
    "git pull, затем git …."
  ],
  "check": { "remotes": true, "messages": "ignore" }
}
```

В репозитории `~/wiki` вы уже сделали коммит «Раздел о встречах». Пока вы работали, коллега Анна отправила на сервер свой коммит с правилами отпусков, и ваш `git push` теперь будет отклонён.

Отправьте свой коммит на сервер, не потеряв коммит Анны: в итоге `main` и `origin/main` должны указывать на один и тот же коммит слияния, в котором есть оба изменения.

```sh setup
git init -q --bare /srv/wiki.git
git clone -q /srv/wiki.git /tmp/anna
cd /tmp/anna
echo "# Вики команды" > README.md
git add README.md
as anna git commit -q -m "Начало вики"
git push -q
cd ~
git clone -q /srv/wiki.git wiki
cd /tmp/anna
echo "Отпуск согласуйте за две недели" > vacation.md
git add vacation.md
as anna git commit -q -m "Правила отпусков"
git push -q
cd ~/wiki
echo "Планёрка по понедельникам в 10:00" > meetings.md
git add meetings.md
git commit -q -m "Раздел о встречах"
```

```sh solution
git pull
git push
```

## task git-fetch-quiz

```json
{
  "type": "choice",
  "title": "Что сделал fetch",
  "xp": 10,
  "hints": [
    "Раздел «git fetch — узнать, что нового».",
    "fetch двигает только ветки наблюдения вроде origin/main."
  ],
  "options": [
    "Два новых коммита скачаны и видны в origin/main, но ваша ветка main и файлы пока не изменились",
    "Два новых коммита уже влиты в main, файлы в рабочей папке обновлены",
    "Ваши два коммита отправлены на сервер",
    "Fetch не сработал: сначала нужно выполнить git push"
  ],
  "answer": [0],
  "explanation": "`git fetch` скачивает коммиты и сдвигает только `origin/main`, поэтому `main` теперь отстаёт (`behind`) на два коммита. Влить их в `main` и обновить файлы сделает `git pull`. Отправляет коммиты `git push`, а ошибки здесь нет: `behind` — обычное сообщение после `fetch`."
}
```

Вы выполнили `git fetch`, после чего `git status` пишет: `Your branch is behind 'origin/main' by 2 commits, and can be fast-forwarded.` Что произошло?
