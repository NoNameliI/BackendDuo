# Защищённые ветки и релизы

В живом проекте `main` — это то, что сейчас работает у пользователей. Случайный push туда может всё сломать, поэтому команды **защищают** основную ветку: изменения попадают в неё только через pull request, после одобрения и проверок. А когда набор изменений готов, его отмечают **релизом** — версией с номером и описанием. В этом уроке вы поработаете с защищённой веткой, спасёте коммит, сделанный не там, проведёте обязательное ревью и выпустите релиз.

Хостинг, как и раньше, учебный: защита, ревью и релизы работают внутри приложения, без аккаунтов, паролей и токенов.

### Защищённая ветка

**Защищённая ветка** — ветка на хостинге с правилами:

- прямой `git push` в неё запрещён — только через pull request (на GitLab — merge request);
- нужно N одобрений ревьюеров, прежде чем PR можно слить;
- нужны успешные автоматические проверки CI (о них — в следующем мире).

Правила задаются во вкладке «Хостинг» на странице **«Настройки»**: флажок «Только через pull request», флажок «Требовать успешные проверки CI» и поле «Нужно одобрений». В своих учебных проектах вы можете включать их сами. На странице «Код» у защищённой ветки стоит пометка «защищена».

Если отправить коммит прямо в защищённый `main`, хостинг откажет:

```
$ git push
remote: error: GH006: Protected branch update failed for refs/heads/main.
remote:
remote: - Changes must be made through a pull request.
 ! [remote rejected] main -> main (protected branch hook declined)
error: failed to push some refs to 'https://github.com/student/shop.git'
```

На GitLab текст другой — `You are not allowed to push code to protected branches on this project`, — но смысл тот же. Коммит остался у вас, на хостинг он не попал.

### Работа через pull request

С защищённой веткой путь всегда такой, как в уроке о pull request:

```sh
git switch -c ветка
git push -u origin ветка
gh pr create --title "Заголовок"
gh pr merge --merge
```

- `git switch -c ветка` — своя ветка для изменения;
- `git push -u origin ветка` — отправка ветки: в незащищённые ветки push разрешён;
- `gh pr create` — запрос на слияние в `main`;
- `gh pr merge --merge` — слияние делает хостинг, проверив правила защиты.

```sh example
git switch -c about
echo "Мы продаём чай с 2010 года" > about.md
git add about.md
git commit -m "Страница о магазине"
git push -u origin about
gh pr create --fill
gh pr view
gh pr merge --squash --delete-branch
git switch main
git pull
```

### Если коммит уже сделан в main

Частая ситуация: вы закоммитили прямо в `main`, и push отклонён. Переделывать ничего не нужно — коммит переносят в ветку:

```sh
git switch -c ветка
git push -u origin ветка
gh pr create --fill
```

- `git switch -c ветка` создаёт ветку **на текущем коммите**, поэтому ваш коммит сразу оказывается в ней;
- дальше — обычный путь через pull request;
- локальный `main` пока опережает `origin/main` на этот коммит. Когда PR сольют, `git switch main` и `git pull` перемотают `main` вперёд, и он совпадёт с хостингом.

```sh example
echo "Часы работы: 10:00–20:00" > hours.md
git add hours.md
git commit -m "Часы работы"
git status
git switch -c hours
git push -u origin hours
gh pr create --fill
gh pr merge --merge --delete-branch
git switch main
git pull
git status
```

### Обязательные одобрения

Если в правилах указано «Нужно одобрений: 1», слить PR без ревью нельзя. `gh pr view` объясняет, чего не хватает:

```
$ gh pr view 1
Страница доставки #1
Open • anna wants to merge 1 commit into main from delivery

Слить пока нельзя: нужно одобрений: 1, есть: 0.
```

А `gh pr merge` откажет: `Pull request #1 is not mergeable: нужно одобрений: 1, есть: 0`.

Что делать:

- чужой PR — проведите ревью и одобрите: `gh pr review номер --approve`, затем `gh pr merge`;
- свой PR — одобрить его сами вы не можете. Нажмите на странице PR кнопку «Попросить ревью у наставника» и дождитесь одобрения.

Одобрение автора не считается: правило «нужен второй взгляд» именно об этом.

### Релиз

**Релиз** — именованная версия проекта на хостинге: тег (например, `v1.0`), заголовок и описание изменений. Пользователи смотрят релизы, чтобы понять, что нового.

```sh
gh release create тег --title "Заголовок" --notes "Что нового"
```

- `release create` — создать релиз;
- `тег` — номер версии; если такого тега нет, хостинг создаст его на последнем коммите основной ветки;
- `--title` — заголовок релиза; без него заголовком станет тег;
- `--notes` — описание изменений.

Посмотреть релизы: `gh release list` (список, последний помечен `Latest`) и `gh release view тег` (подробности). Они же — на странице «Релизы» во вкладке «Хостинг». На GitLab команды те же, только с `glab`.

Тег создан на хостинге, у вас его пока нет. Забирает теги обычный `git fetch` (или `git pull`): в выводе будет строка `* [new tag]`.

```sh example
gh release create v0.9 --title "Пробная версия" --notes "Страница о магазине и часы работы"
gh release list
gh release view v0.9
git fetch
git tag
```

### Частые ошибки

- Повторять `git push` в защищённый `main` → отказ `GH006` не исчезнет. Перенесите коммит в ветку: `git switch -c ветка`, затем push и PR.
- `git reset --hard` после отказа «чтобы начать заново» → можно потерять работу. Коммит переносится в ветку одной командой `git switch -c`.
- `gh pr review --approve` своего PR в проекте, где нужно одобрение → `Can not approve your own pull request`. Попросите ревью у наставника.
- Ждать тег релиза в `git tag` сразу после `gh release create` → тег на хостинге. Выполните `git fetch`.

### Шпаргалка

- защищённая ветка: только PR, N одобрений, проверки CI; правила — «Хостинг» → «Настройки»
- отказ `GH006` / `not allowed to push code to protected branches` → ветка и PR
- коммит в `main` по ошибке: `git switch -c ветка`, `git push -u origin ветка`, `gh pr create --fill`
- после слияния: `git switch main`, `git pull`
- одобрение чужого PR: `gh pr review номер --approve`; своего — кнопка «Попросить ревью у наставника»
- `gh release create тег --title "…" --notes "…"`, `gh release list`, `gh release view тег`
- `git fetch` — забрать теги релизов

## task git-protected-pr

```json
{
  "type": "hosting",
  "title": "Через PR в защищённый main",
  "xp": 15,
  "hints": [
    "Раздел «Работа через pull request».",
    "Прямой push в main отклонят. Нужны ветка delivery, коммит, push ветки, PR и слияние с флагом --merge.",
    "git switch -c …, файл и коммит, git push -u origin …, gh pr create --fill, gh pr merge --merge --…."
  ]
}
```

Проект `student/shop` опубликован на учебном GitHub, ветка `main` защищена: изменения — только через pull request. Терминал открыт в `~/shop` на ветке `main`.

1. Создайте ветку `delivery` с файлом `delivery.md`, в котором одна строка `Доставка по городу бесплатно`. Сделайте коммит.
2. Отправьте ветку и откройте pull request в `main`.
3. Слейте его обычным слиянием (с коммитом слияния) и удалите ветку `delivery` на хостинге.

```sh setup
mkdir shop
cd shop
git init -q
echo "# Магазин чая" > README.md
git add README.md
git commit -q -m "Описание"
gh repo create shop --public --source=. --push
hosting protect student/shop main
```

```sh solution
git switch -c delivery
echo "Доставка по городу бесплатно" > delivery.md
git add delivery.md
git commit -m "Условия доставки"
git push -u origin delivery
gh pr create --fill
gh pr merge --merge --delete-branch
git switch main
git pull
```

## task git-protected-rescue

```json
{
  "type": "hosting",
  "title": "Коммит не в той ветке",
  "xp": 15,
  "hints": [
    "Раздел «Если коммит уже сделан в main».",
    "git switch -c создаёт ветку на текущем коммите — коммит «Прайс» окажется в ней. Затем push ветки и PR.",
    "git switch -c prices, git push -u origin …, gh pr create --…"
  ]
}
```

В `~/shop` вы сделали коммит «Прайс» прямо в `main`, а `main` на хостинге защищён, и `git push` отклоняется.

Не переделывая коммит, перенесите его в новую ветку `prices`, отправьте её на хостинг и откройте pull request в `main`. Сливать PR не нужно: его посмотрит наставник. Ветка `main` на хостинге должна остаться без изменений.

```sh setup
mkdir shop
cd shop
git init -q
echo "# Магазин чая" > README.md
git add README.md
git commit -q -m "Описание"
gh repo create shop --public --source=. --push
hosting protect student/shop main
echo "Пуэр — 500 ₽" > prices.txt
git add prices.txt
git commit -q -m "Прайс"
```

```sh solution
git switch -c prices
git push -u origin prices
gh pr create --fill
```

## task git-required-approval

```json
{
  "type": "hosting",
  "title": "Обязательное одобрение",
  "xp": 15,
  "hints": [
    "Раздел «Обязательные одобрения».",
    "gh pr view 1 покажет, чего не хватает для слияния. PR не ваш, значит, одобрить его можете вы.",
    "gh pr review 1 --…, затем gh pr merge 1 --squash --…"
  ]
}
```

В проекте `student/shop` ветка `main` защищена и требует одно одобрение. Коллега Анна открыла pull request `#1` «Страница доставки». Терминал открыт в `~/shop`.

Одобрите PR Анны, затем слейте его способом squash (один коммит в `main`) и удалите её ветку `delivery` на хостинге.

```sh setup
mkdir shop
cd shop
git init -q
echo "# Магазин чая" > README.md
git add README.md
git commit -q -m "Описание"
gh repo create shop --public --source=. --push
hosting protect student/shop main --approvals 1
git clone -q https://github.com/student/shop.git /tmp/anna
cd /tmp/anna
git switch -q -c delivery
echo "Доставка курьером за 300 ₽" > delivery.md
git add delivery.md
as anna git commit -q -m "Страница доставки"
as anna git push -q -u origin delivery
as anna gh pr create --title "Страница доставки" --body "Условия и цена доставки"
cd ~/shop
```

```sh solution
gh pr view 1
gh pr review 1 --approve
gh pr merge 1 --squash --delete-branch
git pull
```

## task git-release-create

```json
{
  "type": "hosting",
  "title": "Первый релиз",
  "xp": 10,
  "hints": [
    "Раздел «Релиз».",
    "Тег, заголовок и описание задаются в одной команде gh release create.",
    "gh release create v1.0 --title \"…\" --notes \"…\""
  ],
  "check": {
    "localTags": true,
    "titles": true
  }
}
```

Магазин `student/shop` готов к запуску. Терминал открыт в `~/shop`.

Выпустите на учебном GitHub релиз с тегом `v1.0`, заголовком **Первая версия** и описанием **Каталог, цены и доставка**. Затем заберите тег релиза в свой локальный репозиторий.

```sh setup
mkdir shop
cd shop
git init -q
echo "# Магазин чая" > README.md
git add README.md
git commit -q -m "Описание"
echo "Пуэр — 500 ₽" > prices.txt
git add prices.txt
git commit -q -m "Прайс"
echo "Доставка по городу бесплатно" > delivery.md
git add delivery.md
git commit -q -m "Условия доставки"
gh repo create shop --public --source=. --push
hosting protect student/shop main
```

```sh solution
gh release create v1.0 --title "Первая версия" --notes "Каталог, цены и доставка"
git fetch
git tag
```
