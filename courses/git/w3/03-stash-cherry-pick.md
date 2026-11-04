# stash и cherry-pick

Вы на середине работы над тёмной темой сайта, файлы изменены, до коммита далеко. И тут просят срочно поправить другую ветку. Коммитить полуготовое не хочется, а с изменёнными файлами Git может не дать переключиться. Выход — отложить изменения в сторону командой `git stash`, а потом вернуть их. Вторая команда урока, `git cherry-pick`, решает другую задачу: перенести один нужный коммит из чужой ветки в свою, не сливая всю ветку.

### git stash — отложить изменения

`git stash` сохраняет незакоммиченные изменения в специальное хранилище и возвращает рабочую папку и индекс к последнему коммиту.

```sh
git stash
git stash -m "описание"
git stash -u
```

- `stash` — отложить изменения отслеживаемых файлов: и из рабочей папки, и из индекса;
- `-m "описание"` — подпись записи, чтобы потом её узнать; без неё запись называется `WIP on ветка: …` по последнему коммиту;
- `-u` — отложить и неотслеживаемые файлы. Без этого флага новые файлы остаются в папке;
- флаги можно сочетать: `git stash -u -m "описание"`.

В репозитории изменён `style.css` и создан новый `dark.md`. Отложим изменения без флагов:

```sh example
git stash
git status
```

Git печатает `Saved working directory and index state WIP on main: … Каркас сайта`. В `git status` остался только неотслеживаемый `dark.md`: без `-u` новые файлы не откладываются.

```sh example
git stash -u -m "Черновик темы"
git status
```

Теперь `git status` пишет `nothing to commit, working tree clean`.

### git stash list — список отложенного

Отложить можно несколько раз. Записи складываются стопкой: новая сверху.

```sh
git stash list
```

- каждая строка — одна запись: `stash@{n}: подпись`;
- `stash@{0}` — самая свежая запись, `stash@{1}` — предыдущая, и так далее.

```sh example
git stash list
```

В выводе две строки: `stash@{0}: On main: Черновик темы` и `stash@{1}: WIP on main: … Каркас сайта`.

### git stash pop и git stash apply — вернуть изменения

```sh
git stash pop
git stash pop stash@{n}
git stash apply
git stash apply stash@{n}
```

- `pop` — вернуть изменения и удалить запись из списка;
- `apply` — вернуть изменения, но оставить запись: пригодится, если те же изменения нужны ещё в одной ветке;
- без номера берётся `stash@{0}`; `stash@{n}` выбирает конкретную запись;
- изменения отслеживаемых файлов возвращаются в рабочую папку вне индекса. Если раньше они были в индексе, снова выполните `git add`.

```sh example
git stash pop
git stash list
```

Вернулся `dark.md`, а Git напечатал `Dropped refs/stash@{0} (…)`. В списке осталась одна запись, и теперь она `stash@{0}`: номера сдвигаются.

```sh example
git stash apply
git stash list
```

Изменения `style.css` вернулись, но запись по-прежнему в списке.

Изменения можно вернуть и в другой ветке, не только в той, где вы их отложили. Если те же строки за это время изменились, при `pop` или `apply` случится конфликт; запись при этом не удаляется.

### git stash drop — удалить запись

```sh
git stash drop
git stash drop stash@{n}
```

- `drop` — удалить запись без применения; без номера удаляется `stash@{0}`.

После `apply` запись больше не нужна, удалим её:

```sh example
git stash drop
git add style.css dark.md
git commit -m "Тёмная тема"
```

### git cherry-pick — скопировать коммит

`git cherry-pick` берёт изменения одного коммита и повторяет их в текущей ветке новым коммитом. Сообщение и автор те же, идентификатор новый. Исходная ветка не меняется.

```sh
git cherry-pick коммит
```

- `cherry-pick` — «сорвать вишенку»: взять один коммит, а не всю ветку;
- `коммит` — что скопировать: имя ветки (её последний коммит), `ветка~1`, `ветка~2` или короткий идентификатор из `git log --oneline ветка`;
- сначала переключитесь на ветку, куда копируете.

Подготовим ветку `sale` с двумя коммитами и перенесём в `main` только первый:

```sh example
git switch -c sale
echo "Скидки до 30%" > sale.html
git add sale.html
git commit -m "Страница распродажи"
echo "<h1>Магазин чая</h1>" > index.html
git add index.html
git commit -m "Новый заголовок"
git switch main
git cherry-pick sale~1
git log --oneline -n 2
```

Git печатает `[main …] Страница распродажи` и строку `Date:` с датой исходного коммита. В `main` появилась страница распродажи, а заголовок остался прежним: второй коммит ветки не переносился.

### Конфликт при cherry-pick

Если в вашей ветке те же строки уже изменены по-другому, Git остановится с конфликтом:

```sh
CONFLICT (content): Merge conflict in index.html
error: could not apply a3a7818... Новый заголовок
hint: After resolving the conflicts, mark them with
hint: "git add/rm <pathspec>", then run
hint: "git cherry-pick --continue".
```

Порядок действий тот же, что при конфликте слияния:

```sh
git add файл
git cherry-pick --continue
git cherry-pick --abort
```

- откройте файл, оставьте нужный вариант и удалите маркеры `<<<<<<<`, `=======`, `>>>>>>>`;
- `git add файл` — отметить, что конфликт в файле решён;
- `--continue` — закончить перенос: Git сделает коммит с исходным сообщением;
- `--abort` — отказаться от переноса и вернуть ветку к состоянию до команды.

В примерах и эталонных решениях вы встретите запись `команда1 || команда2`: вторая команда выполняется, только если первая завершилась ошибкой. Ниже `git status` показывает состояние сразу после конфликта.

```sh example
echo "<h1>Чайная лавка</h1>" > index.html
git add index.html
git commit -m "Другой заголовок"
git cherry-pick sale || git status
cat index.html
git cherry-pick --abort
git status
```

`git status` сообщает `You are currently cherry-picking commit …` и `both modified: index.html`. В файле обе версии заголовка между маркерами. После `--abort` рабочая папка снова чистая.

### Частые ошибки

- `git stash` при новых файлах → они остаются в папке и «переезжают» в другую ветку. Добавьте `-u`: `git stash -u`.
- `git stash pop`, когда нужна не последняя запись → вернётся `stash@{0}`. Сначала `git stash list`, затем `git stash pop stash@{n}`.
- `git cherry-pick` из ветки, на которой вы стоите → коммит уже здесь. Сначала переключитесь на ветку-получатель: `git switch main`.
- `git cherry-pick --continue` сразу после правки файла → Git ответит `Committing is not possible because you have unmerged files`. Сначала отметьте решение: `git add файл`.

### Шпаргалка

- `git stash`, `git stash -m "описание"`, `git stash -u` — отложить изменения
- `git stash list` — список записей, `stash@{0}` — самая свежая
- `git stash pop [stash@{n}]` — вернуть и удалить запись
- `git stash apply [stash@{n}]` — вернуть и оставить запись
- `git stash drop [stash@{n}]` — удалить запись
- `git cherry-pick коммит` — скопировать коммит в текущую ветку
- `git cherry-pick --continue`, `git cherry-pick --abort` — после конфликта

## task git-stash-untracked

```json
{
  "type": "commands",
  "title": "Отложить всё",
  "xp": 10,
  "hints": [
    "Раздел «git stash — отложить изменения»: какой флаг нужен для новых файлов и как подписать запись.",
    "Одна команда git stash с двумя флагами: для неотслеживаемых файлов и для описания.",
    "git stash -… -m \"…\""
  ],
  "check": {
    "require": [
      {
        "pattern": "^git stash\\b(?=.* (-u|--include-untracked)\\b)(?=.* (-m|--message) )",
        "message": "Отложите изменения одной командой git stash с флагом -u (новые файлы) и описанием -m \"Тёмная тема\""
      }
    ]
  }
}
```

В репозитории `~/shop` вы начали тёмную тему: изменили `style.css` и создали новый файл `dark.md`. Срочно нужно заняться другой задачей.

Отложите все изменения, включая новый файл `dark.md`, одной командой и подпишите запись описанием **Тёмная тема**. Проверьте результат командой `git status`: рабочая папка должна стать чистой.

```sh setup
mkdir shop
cd shop
git init -q
echo "body { color: black; }" > style.css
echo "<h1>Магазин</h1>" > index.html
git add style.css index.html
git commit -q -m "Каркас сайта"
echo "body { color: white; background: black; }" > style.css
echo "Тёмная тема: черновик" > dark.md
```

```sh solution
git stash -u -m "Тёмная тема"
```

## task git-stash-pop-older

```json
{
  "type": "worktree",
  "title": "Не та запись",
  "xp": 10,
  "hints": [
    "Разделы «git stash list — список отложенного» и «git stash pop и git stash apply — вернуть изменения».",
    "Посмотрите git stash list: запись «Меню» не самая свежая, поэтому её номер нужно указать явно.",
    "git stash pop stash@{…}"
  ]
}
```

В репозитории `~/cafe` отложены две записи: сначала изменения меню с описанием «Меню», потом изменения подвала сайта с описанием «Подвал». Рабочая папка чистая.

Верните в рабочую папку изменения из записи **Меню** и удалите эту запись из списка. Запись «Подвал» должна остаться отложенной, а `footer.txt` — без изменений.

```sh setup
mkdir cafe
cd cafe
git init -q
echo "Кофе — 150" > menu.txt
echo "Адрес: ул. Ленина, 1" > footer.txt
git add menu.txt footer.txt
git commit -q -m "Меню и подвал"
echo "Чай — 100" >> menu.txt
git stash -q -m "Меню"
echo "Адрес: ул. Мира, 5" > footer.txt
git stash -q -m "Подвал"
```

```sh solution
git stash pop stash@{1}
```

## task git-cherry-pick-fix

```json
{
  "type": "graph",
  "title": "Только исправление",
  "xp": 15,
  "hints": [
    "Раздел «git cherry-pick — скопировать коммит».",
    "Вы уже на main. Нужный коммит — предпоследний в ветке develop: сослаться на него можно как develop~1.",
    "git cherry-pick develop~…"
  ]
}
```

В репозитории `~/store` ветка `develop` ушла вперёд на три коммита: «Новый дизайн корзины», «Исправлен расчёт скидки» и «Черновик отзывов». Сливать её в `main` рано, но исправление скидки нужно пользователям уже сейчас.

Вы на ветке `main`. Перенесите в неё только коммит **Исправлен расчёт скидки**, сохранив его сообщение. Ветка `develop` должна остаться без изменений.

```sh setup
mkdir store
cd store
git init -q
echo "Магазин" > README.md
echo "total = price - 10" > discount.js
git add README.md discount.js
git commit -q -m "Каркас магазина"
git switch -q -c develop
echo ".cart { display: grid; }" > cart.css
git add cart.css
git commit -q -m "Новый дизайн корзины"
echo "total = price * 0.9" > discount.js
git add discount.js
git commit -q -m "Исправлен расчёт скидки"
echo "<p>Отзывы скоро</p>" > reviews.html
git add reviews.html
git commit -q -m "Черновик отзывов"
git switch -q main
```

```sh solution
git cherry-pick develop~1
```

## task git-cherry-pick-conflict

```json
{
  "type": "graph",
  "title": "Перенос с конфликтом",
  "xp": 20,
  "hints": [
    "Разделы «git cherry-pick — скопировать коммит» и «Конфликт при cherry-pick».",
    "После конфликта запишите в limits.txt одну строку upload_limit=50 (через редактор или echo), добавьте файл в индекс и продолжите перенос.",
    "git cherry-pick hotfix, затем echo \"…\" > limits.txt, git add limits.txt и git cherry-pick --…"
  ]
}
```

В репозитории `~/uploader` файл `limits.txt` содержит одну строку с лимитом загрузки. В ветке `main` последний коммит «Лимит загрузки 20 МБ» записал туда `upload_limit=20`. В ветке `hotfix` есть коммит «Лимит загрузки 50 МБ» с `upload_limit=50`.

Вы на `main`. Перенесите в неё последний коммит ветки `hotfix`. Возникнет конфликт: решите его так, чтобы в `limits.txt` осталась одна строка `upload_limit=50`, и завершите перенос. Последним коммитом `main` должен стать **Лимит загрузки 50 МБ**.

```sh setup
mkdir uploader
cd uploader
git init -q
echo "upload_limit=10" > limits.txt
git add limits.txt
git commit -q -m "Начальные настройки"
git switch -q -c hotfix
echo "upload_limit=50" > limits.txt
git add limits.txt
git commit -q -m "Лимит загрузки 50 МБ"
git switch -q main
echo "upload_limit=20" > limits.txt
git add limits.txt
git commit -q -m "Лимит загрузки 20 МБ"
```

```sh solution
git cherry-pick hotfix || git status
echo "upload_limit=50" > limits.txt
git add limits.txt
git cherry-pick --continue
```
