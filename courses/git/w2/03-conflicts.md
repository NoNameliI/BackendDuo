# Конфликты слияния

Вы с коллегой поправили одну и ту же строку в заголовке лендинга: вы написали «Скидки до 50%», а коллега в своей ветке — «Скидки до 70%». При слиянии Git не может сам решить, какой вариант правильный, и останавливается с **конфликтом**. Это обычная рабочая ситуация, а не авария: Git показывает обе версии и ждёт вашего решения. В этом уроке вы научитесь читать конфликт, разрешать его и при необходимости отменять слияние.

Примеры урока выполняются в репозитории `~/landing`, где слияние уже началось и упёрлось в конфликт.

### Почему возникает конфликт

При трёхстороннем слиянии Git сравнивает обе ветки с их общим предком (вы знаете это по прошлому уроку). Если ветки меняли **разные** места файлов, Git объединяет изменения сам. Конфликт возникает, когда:

- обе ветки изменили **одни и те же строки** одного файла, и по-разному;
- одна ветка изменила файл, а другая его удалила.

В `~/landing` ветка `main` заменила строку в `title.txt` на «Скидки до 50%», а ветка `promo` — на «Скидки до 70%». Команда `git merge promo` закончилась так:

```
Auto-merging title.txt
CONFLICT (content): Merge conflict in title.txt
Automatic merge failed; fix conflicts and then commit the result.
```

- `Auto-merging title.txt` — Git попытался слить файл сам;
- `CONFLICT (content)` — конфликт в содержимом, ниже — имя файла;
- `Automatic merge failed` — коммит слияния не создан: Git ждёт, пока вы исправите файлы и сделаете коммит сами.

Слияние при этом не отменяется, а **остаётся незавершённым**.

### Незавершённое слияние: git status и (main|MERGING)

Во время незавершённого слияния приглашение терминала меняется: `~/landing (main|MERGING) $`. Слово `MERGING` напоминает, что слияние ещё не закончено. Пока оно висит, не переключайте ветки и не начинайте новую работу.

Что именно не так, показывает уже знакомая команда:

```sh example
git status
```

```
On branch main
You have unmerged paths.
  (fix conflicts and run "git commit")
  (use "git merge --abort" to abort the merge)

Unmerged paths:
  (use "git add <file>..." to mark resolution)
	both modified:   title.txt

no changes added to commit (use "git add" and/or "git commit -a")
```

- `You have unmerged paths` — есть файлы с неразрешёнными конфликтами;
- `Unmerged paths` — их список; `both modified` значит «изменён в обеих ветках»;
- в скобках Git сам подсказывает оба выхода: исправить и сделать `git commit` или отменить через `git merge --abort`.

Файлы без конфликтов Git уже слил и положил в индекс — их трогать не нужно.

### Маркеры конфликта

В файл с конфликтом Git записывает обе версии и отделяет их **маркерами**:

```sh example
cat title.txt
```

```
<<<<<<< HEAD
Скидки до 50%
=======
Скидки до 70%
>>>>>>> promo
```

- `<<<<<<< HEAD` — начало вашей версии: так строка выглядит в текущей ветке (`main`);
- `=======` — разделитель между версиями;
- `>>>>>>> promo` — конец версии из вливаемой ветки, после маркера — её имя;
- всё, что вне маркеров, совпало в обеих ветках и осталось как есть.

Маркеры — обычный текст в файле. Git не уберёт их сам: это делаете вы.

### Разрешение конфликта

Разрешить конфликт — значит привести файл к нужному виду, сообщить об этом Git и закончить слияние коммитом.

```sh
echo "итоговый текст" > файл
git add файл
git commit --no-edit
```

1. **Исправьте файл.** Оставьте нужный вариант (одну из версий, обе или новый текст) и удалите все три маркера. Удобно открыть файл в панели «Редактор» и сохранить его клавишами Ctrl+S. Если файл короткий, можно перезаписать его командой `echo "…" > файл`, а следующие строки дописать через `>>`.
2. **`git add файл`** — отметить конфликт как разрешённый. После этого `git status` пишет `All conflicts fixed but you are still merging.`
3. **Завершите слияние коммитом:**
   - `git commit --no-edit` — взять подготовленное Git сообщение `Merge branch 'promo'`; флаг `--no-edit` значит «не менять сообщение»;
   - или `git commit -m "Сообщение"` — своё сообщение для коммита слияния.

Например, если в `~/landing` оставить вариант из `main`, получится так:

```
~/landing (main|MERGING) $ echo "Скидки до 50%" > title.txt
~/landing (main|MERGING) $ git add title.txt
~/landing (main|MERGING) $ git commit --no-edit
[main 4685df4] Merge branch 'promo'
~/landing (main) $
```

Слово `MERGING` пропало: слияние завершено, на графе появился коммит слияния с двумя родителями.

### git merge --abort — отменить слияние

Если конфликтов слишком много или вы поняли, что сливать рано, слияние можно отменить целиком:

```sh
git merge --abort
```

- `--abort` — прервать: вернуть ветку, индекс и файлы к состоянию до `git merge`;
- работает только пока слияние не завершено коммитом.

```sh example
git merge --abort
git status
```

`git merge --abort` ничего не печатает. После него `git status` отвечает `nothing to commit, working tree clean`, а из приглашения исчезает `MERGING`. Ветка `promo` не меняется, слить её можно позже.

### Когда конфликта не будет

Если ветки поменяли разные строки одного файла, Git сольёт их без вашей помощи. В файле `card.txt` три строки. Поменяем подпись в новой ветке, а обращение — в `main`:

```sh example
git switch -c sign
echo "Дорогие покупатели," > card.txt
echo "поздравляем с праздником." >> card.txt
echo "Команда магазина" >> card.txt
git add card.txt
git commit -m "Новая подпись"
git switch main
echo "Уважаемые покупатели," > card.txt
echo "поздравляем с праздником." >> card.txt
echo "Ваш магазин" >> card.txt
git add card.txt
git commit -m "Новое обращение"
git merge sign
cat card.txt
```

Git пишет `Auto-merging card.txt` и `Merge made by the 'ort' strategy.`, а в файле обе правки: «Уважаемые покупатели,» в начале и «Команда магазина» в конце. Конфликт возник бы, только если бы обе ветки поменяли одну и ту же строку.

Отсюда практический совет: чем меньше и короче ветки, тем реже они правят одни и те же строки и тем реже бывают конфликты.

### Частые ошибки

- Закоммитили файл с маркерами → Git не проверяет содержимое, и `<<<<<<<` попадёт в историю. Перед `git add` посмотрите файл: `cat файл`.
- `git commit` до `git add` → `Committing is not possible because you have unmerged files`. Сначала `git add файл` для каждого исправленного файла.
- Удалили маркеры, но и нужные строки вместе с ними → проверьте, что в файле остался именно тот текст, который вы хотели.
- Решили начать заново посреди конфликта → не переключайте ветки, а выполните `git merge --abort`.

### Шпаргалка

- `CONFLICT (content): Merge conflict in файл` — конфликт, слияние не завершено
- `(main|MERGING)` в приглашении — идёт слияние
- `git status` → `Unmerged paths`, `both modified` — файлы с конфликтами
- `<<<<<<< HEAD` … `=======` … `>>>>>>> ветка` — ваша версия и версия вливаемой ветки
- исправить файл → `git add файл` → `git commit --no-edit` или `git commit -m "Сообщение"`
- `git merge --abort` — отменить незавершённое слияние

## task git-conflict-promo

```json
{
  "type": "graph",
  "title": "Первый конфликт",
  "xp": 15,
  "hints": [
    "Раздел «Разрешение конфликта».",
    "Посмотрите файл командой cat title.txt. Перезапишите его одной строкой из ветки promo (без маркеров), добавьте в индекс и завершите слияние коммитом.",
    "echo \"…\" > title.txt, затем git add …, затем git commit --no-edit"
  ],
  "check": {
    "messages": "ignore"
  }
}
```

В репозитории `~/landing` вы выполнили `git merge promo` и получили конфликт в файле `title.txt`: в `main` там «Скидки до 50%», а в ветке `promo` — «Скидки до 70%».

Маркетологи решили, что правильный вариант — из ветки `promo`. Разрешите конфликт так, чтобы в `title.txt` осталась одна строка `Скидки до 70%`, и завершите слияние. Сообщение коммита слияния — любое.

```sh setup
mkdir landing
cd landing
git init -q
echo "Скидки до 30%" > title.txt
cat > card.txt <<'EOF'
Дорогие покупатели,
поздравляем с праздником.
Ваш магазин
EOF
git add title.txt card.txt
git commit -q -m "Первая версия лендинга"
git switch -q -c promo
echo "Скидки до 70%" > title.txt
git add title.txt
git commit -q -m "Большие скидки"
git switch -q main
echo "Скидки до 50%" > title.txt
git add title.txt
git commit -q -m "Скидки поскромнее"
git merge promo || echo
```

```sh solution
echo "Скидки до 70%" > title.txt
git add title.txt
git commit --no-edit
```

## task git-conflict-abort

```json
{
  "type": "graph",
  "title": "Отложить слияние",
  "xp": 10,
  "hints": [
    "Раздел «git merge --abort — отменить слияние».",
    "Исправлять файлы не нужно: одна команда вернёт всё к состоянию до git merge. Проверьте результат через git status.",
    "git merge --…"
  ]
}
```

В репозитории `~/wiki` вы начали вливать в `main` ветку `redesign` и получили конфликты сразу в двух файлах: `index.txt` и `style.txt`. Посмотрите их командой `git status`.

Автор редизайна ещё не закончил работу, и слияние решили отложить. Отмените начатое слияние: ветка `main` должна остаться прежней, слияние — не продолжаться.

```sh setup
mkdir wiki
cd wiki
git init -q
echo "Добро пожаловать в вики" > index.txt
echo "font: serif" > style.txt
git add index.txt style.txt
git commit -q -m "Первая версия вики"
git switch -q -c redesign
echo "Вики команды" > index.txt
echo "font: sans-serif" > style.txt
git add index.txt style.txt
git commit -q -m "Новый дизайн"
git switch -q main
echo "Вики проекта" > index.txt
echo "font: monospace" > style.txt
git add index.txt style.txt
git commit -q -m "Правки текста и шрифта"
git merge redesign || echo
```

```sh solution
git merge --abort
```

## task git-conflict-contacts

```json
{
  "type": "graph",
  "title": "Оставить обе версии",
  "xp": 20,
  "hints": [
    "Разделы «Маркеры конфликта» и «Разрешение конфликта».",
    "Нужны обе строки из конфликта, без маркеров, в порядке: Контакты, телефон, почта. Первую строку запишите через >, следующие допишите через >> (или поправьте файл в редакторе и сохраните Ctrl+S). Затем git add и коммит с сообщением из условия.",
    "echo \"Контакты\" > contacts.txt, echo \"…\" >> contacts.txt (дважды), git add …, git commit -m \"…\""
  ]
}
```

В репозитории `~/shop` вы вливаете в `main` ветку `email` и получили конфликт в `contacts.txt`. Обе ветки дописали строку в конец файла: `main` — телефон, `email` — почту. Посмотрите файл командой `cat contacts.txt`.

Нужны обе строки. Разрешите конфликт так, чтобы файл `contacts.txt` состоял ровно из трёх строк:

```
Контакты
Телефон: 8-800-000-00-00
Почта: shop@example.com
```

Завершите слияние коммитом с сообщением **Телефон и почта в контактах**.

```sh setup
mkdir shop
cd shop
git init -q
echo "Контакты" > contacts.txt
git add contacts.txt
git commit -q -m "Страница контактов"
git switch -q -c email
echo "Почта: shop@example.com" >> contacts.txt
git add contacts.txt
git commit -q -m "Почта магазина"
git switch -q main
echo "Телефон: 8-800-000-00-00" >> contacts.txt
git add contacts.txt
git commit -q -m "Телефон магазина"
git merge email || echo
```

```sh solution
echo "Контакты" > contacts.txt
echo "Телефон: 8-800-000-00-00" >> contacts.txt
echo "Почта: shop@example.com" >> contacts.txt
git add contacts.txt
git commit -m "Телефон и почта в контактах"
```

## task git-conflict-markers-review

```json
{
  "type": "review",
  "title": "Чья это строка",
  "xp": 10,
  "hints": [
    "Раздел «Маркеры конфликта».",
    "HEAD — это текущая ветка, то есть та, в которую вы вливаете. Имя после >>>>>>> — вливаемая ветка."
  ],
  "options": [
    "`port = 8080` пришла из `feature/docker`, а `port = 9090` — из `main`",
    "`port = 8080` — версия `main` (HEAD), `port = 9090` — версия `feature/docker`",
    "Обе строки пришли из `feature/docker`, а `main` этот файл не меняла",
    "Маркеры добавил Git для справки: файл можно закоммитить как есть"
  ],
  "answer": [1],
  "lines": [3, 5],
  "explanation": "Между `<<<<<<< HEAD` и `=======` — версия текущей ветки, то есть `main`, куда вы вливаете: `port = 8080`. Между `=======` и `>>>>>>> feature/docker` — версия вливаемой ветки: `port = 9090`. Строка `name = shop` стоит вне маркеров: она совпала в обеих ветках. Конфликт возможен только если обе ветки изменили одну строку, поэтому `main` файл меняла. Маркеры — обычный текст: если закоммитить файл как есть, они попадут в историю, и конфиг перестанет читаться."
}
```

Вы на ветке `main` выполнили `git merge feature/docker` и получили конфликт в файле `config.ini`:

```ini code
name = shop
<<<<<<< HEAD
port = 8080
=======
port = 9090
>>>>>>> feature/docker
```

Какая версия строки `port` из какой ветки?
