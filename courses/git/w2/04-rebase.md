# Перебазирование

Вы три дня делали поиск в своей ветке, а `main` за это время ушла вперёд. Слияние сработает, но в истории появится ещё одна «петля», и через месяц граф станет похож на клубок. **Перебазирование** (rebase) решает это иначе: ваши коммиты переносятся поверх свежей `main`, будто вы начали работу только что. История остаётся прямой линией. В этом уроке вы научитесь перебазировать ветку, разрешать конфликты по ходу и поймёте, когда rebase делать нельзя.

### Что делает rebase

Допустим, ветка `footer` ответвилась от `main`, и после этого в обеих ветках появились коммиты. Команда `git rebase main`, выполненная на `footer`:

1. находит коммиты `footer`, которых нет в `main`;
2. по очереди **повторяет** их поверх последнего коммита `main` — с теми же изменениями и сообщениями;
3. передвигает метку `footer` на последний повторённый коммит.

Повторённые коммиты — **новые** коммиты: у них другие родители, а значит, другие идентификаторы. Старые коммиты из истории ветки пропадают. Ветка `main` при этом не меняется.

### git rebase — перенести ветку на другую

```sh
git switch ваша-ветка
git rebase основа
```

- `git switch ваша-ветка` — rebase переносит **текущую** ветку, поэтому сначала перейдите на неё;
- `rebase` — перебазировать: поставить коммиты текущей ветки поверх другой;
- `основа` — ветка, поверх которой ставить коммиты; обычно `main`.

Направление обратное слиянию: при `merge` вы стоите на `main` и принимаете чужую ветку, при `rebase` — стоите на своей ветке и переносите её на `main`.

Подготовим разошедшиеся ветки: подвал в отдельной ветке и логотип в `main`.

```sh example
git switch -c footer
echo "подвал" > footer.txt
git add footer.txt
git commit -m "Подвал"
git switch main
echo "логотип" > logo.txt
git add logo.txt
git commit -m "Логотип"
git log --oneline --graph --all
```

На графе `footer` и `main` расходятся от коммита «Версия 2». Теперь перебазируем `footer`:

```sh example
git switch footer
git rebase main
git log --oneline --graph --all
```

Git отвечает `Successfully rebased and updated refs/heads/footer.` На графе «Подвал» стоит сразу после «Логотипа», развилки больше нет. Идентификатор коммита «Подвал» сменился: это новый коммит с тем же сообщением.

### Линейная история: rebase, затем слияние

После перебазирования ваша ветка продолжает `main` по прямой. Значит, слияние в `main` будет перемоткой (fast-forward) — без коммита слияния.

```sh example
git switch main
git merge footer
```

Git печатает `Fast-forward`. Вся история `main` — одна прямая линия. Это и есть главная польза rebase: историю легко читать сверху вниз.

### Конфликт при перебазировании

Если ваш коммит и `main` поменяли одну и ту же строку, rebase остановится на этом коммите с конфликтом. Например, в ветке `release` два коммита, «Версия 3» и «Список изменений», а в `main` кто-то тоже поменял `version.txt`:

```
~/app (release) $ git rebase main
Auto-merging version.txt
CONFLICT (content): Merge conflict in version.txt
error: could not apply e888f2f... Версия 3
hint: Resolve all conflicts manually, mark them as resolved with
hint: "git add/rm <conflicted_files>", then run "git rebase --continue".
hint: You can instead skip this commit: run "git rebase --skip".
hint: To abort and get back to the state before "git rebase", run "git rebase --abort".
hint: Disable this message with "git config set advice.mergeConflict false"
Could not apply e888f2f... # Версия 3
~/app (release|REBASE 1/2) $
```

- `could not apply e888f2f... Версия 3` — на каком коммите остановился rebase;
- строки `hint:` — подсказки Git: разрешить конфликт и выполнить `git rebase --continue` или отменить всё через `git rebase --abort` (`--skip` выбрасывает коммит — в курсе он не нужен);
- `(release|REBASE 1/2)` в приглашении — идёт перебазирование ветки `release`, применяется первый коммит из двух.

`git status` в это время пишет `You are currently rebasing branch 'release'` и список файлов в `Unmerged paths`.

Маркеры в файле — те же, что при слиянии, но стороны **поменялись местами**:

```
~/app (release|REBASE 1/2) $ cat version.txt
<<<<<<< HEAD
v3-main
=======
v3-release
>>>>>>> e888f2f (Версия 3)
```

- между `<<<<<<< HEAD` и `=======` — версия из `main`: rebase строит новую историю поверх неё;
- между `=======` и `>>>>>>>` — ваш переносимый коммит; после маркера — его короткий идентификатор и сообщение.

Разрешение похоже на слияние, но завершается не коммитом:

```sh
git add файл
git rebase --continue
```

- исправьте файл и уберите маркеры, как в прошлом уроке;
- `git add файл` — отметить конфликт как разрешённый;
- `git rebase --continue` — продолжить: Git сам сделает коммит с прежним сообщением и перейдёт к следующим коммитам. Если конфликт будет и в следующем коммите, повторите те же шаги.

Когда все коммиты перенесены, Git пишет `Successfully rebased and updated refs/heads/…`, и `REBASE` исчезает из приглашения.

### git rebase --abort — отменить перебазирование

```sh
git rebase --abort
```

- `--abort` — прервать перебазирование и вернуть ветку точно туда, где она была до `git rebase`. Работает, пока rebase не закончен.

Это тот же «аварийный выход», что `git merge --abort` при слиянии. Если запутались в конфликтах, отмените rebase и слейте ветку обычным `git merge`.

### Когда rebase делать нельзя

Rebase **переписывает историю**: старые коммиты заменяются новыми с другими идентификаторами. Пока ветка есть только у вас, это безопасно. Но если коллеги уже взяли себе эту ветку (в мире 4 вы научитесь отправлять ветки на сервер), у них останутся старые коммиты, а у вас — новые. Их истории разойдутся, и при следующей синхронизации появятся дубли коммитов и лишние конфликты.

Правило простое:

- перебазируйте только **свои** ветки, которые ещё никто не забрал;
- никогда не перебазируйте `main` и другие общие ветки;
- общую ветку обновляйте слиянием: `git merge`.

Merge или rebase — вопрос договорённости в команде. Merge честно сохраняет, как шла работа, rebase делает историю прямой. Многие команды перебазируют личные ветки перед слиянием, а в `main` вливают обычным `git merge`.

### Частые ошибки

- `git rebase main`, стоя на `main` → `Current branch main is up to date.`, ничего не происходит. Сначала перейдите на свою ветку.
- `git commit` после разрешения конфликта в rebase → не нужен. Выполните `git add файл` и `git rebase --continue`: коммит Git сделает сам.
- Перепутали стороны в маркерах → при rebase `HEAD` — это `main`, а ваш коммит — после `=======`.
- Перебазировали общую ветку, которой пользуются коллеги → история у вас и у них разошлась. Общие ветки обновляйте через `git merge`.

### Шпаргалка

- `git switch ветка` и `git rebase main` — перенести коммиты ветки поверх `main`
- `Successfully rebased and updated refs/heads/ветка` — готово
- `git switch main` и `git merge ветка` после rebase — перемотка, история прямая
- `(ветка|REBASE 1/2)` в приглашении — идёт перебазирование, шаг 1 из 2
- конфликт: исправить файл → `git add файл` → `git rebase --continue`
- `git rebase --abort` — отменить перебазирование
- не перебазируйте `main` и ветки, с которыми работают другие

## task git-rebase-search

```json
{
  "type": "graph",
  "title": "Перенести ветку на main",
  "xp": 10,
  "hints": [
    "Раздел «git rebase — перенести ветку на другую».",
    "Rebase переносит текущую ветку. Сейчас вы на main — сначала перейдите на search, затем перебазируйте её на main.",
    "git switch …, затем git rebase …"
  ]
}
```

В репозитории `~/app` ветка `search` содержит два коммита: «Поиск по товарам» и «Фильтры поиска». Пока вы над ней работали, в `main` появился коммит «Версия 2». Вы на ветке `main`.

Перебазируйте ветку `search` на `main`, чтобы её коммиты шли сразу после «Версии 2». Ветку `main` не меняйте. В конце оставайтесь на ветке `search`.

```sh setup
mkdir app
cd app
git init -q
echo "v1" > version.txt
git add version.txt
git commit -q -m "Версия 1"
git switch -q -c search
echo "поиск" > search.txt
git add search.txt
git commit -q -m "Поиск по товарам"
echo "фильтры" > filters.txt
git add filters.txt
git commit -q -m "Фильтры поиска"
git switch -q main
echo "v2" > version.txt
git add version.txt
git commit -q -m "Версия 2"
```

```sh solution
git switch search
git rebase main
```

## task git-rebase-linear

```json
{
  "type": "graph",
  "title": "Прямая история",
  "xp": 15,
  "hints": [
    "Раздел «Линейная история: rebase, затем слияние».",
    "Сначала перебазируйте docs на main (вы уже на docs). Потом перейдите на main и влейте docs — получится перемотка без коммита слияния.",
    "git rebase …, git switch …, git merge …"
  ]
}
```

В репозитории `~/guide` вы на ветке `docs`: в ней коммит «Раздел FAQ». В `main` за это время появился коммит «Раздел установки».

Добавьте работу из `docs` в `main` так, чтобы история `main` осталась прямой линией, **без коммита слияния**: коммит «Раздел FAQ» должен идти сразу после «Раздела установки». Ветку `docs` не удаляйте. В конце оставайтесь на `main`.

```sh setup
mkdir guide
cd guide
git init -q
echo "# Руководство" > README.md
git add README.md
git commit -q -m "Начало руководства"
git switch -q -c docs
echo "Частые вопросы" > faq.md
git add faq.md
git commit -q -m "Раздел FAQ"
git switch -q main
echo "Установка: npm install" > install.md
git add install.md
git commit -q -m "Раздел установки"
git switch -q docs
```

```sh solution
git rebase main
git switch main
git merge docs
```

## task git-rebase-conflict

```json
{
  "type": "graph",
  "title": "Конфликт посреди rebase",
  "xp": 20,
  "hints": [
    "Раздел «Конфликт при перебазировании».",
    "Перезапишите settings.txt одной строкой из вашего коммита (без маркеров), добавьте файл в индекс и продолжите перебазирование. Коммит вручную делать не нужно: второй коммит Git перенесёт сам.",
    "echo \"…\" > settings.txt, git add …, git rebase --…"
  ]
}
```

В репозитории `~/server` вы перебазируете ветку `fast` на `main`. В ветке два коммита: «Уменьшен таймаут» и «Повторы запросов». Rebase остановился на первом из них с конфликтом в `settings.txt`: в `main` там `timeout = 60`, а в вашем коммите — `timeout = 10`. Посмотрите приглашение терминала и файл командой `cat settings.txt`.

Разрешите конфликт в пользу вашего коммита: в `settings.txt` должна остаться одна строка `timeout = 10`. Доведите перебазирование до конца. Оба коммита ветки `fast` должны сохранить свои сообщения и идти после последнего коммита `main`.

```sh setup
mkdir server
cd server
git init -q
echo "timeout = 30" > settings.txt
git add settings.txt
git commit -q -m "Настройки сервера"
git switch -q -c fast
echo "timeout = 10" > settings.txt
git add settings.txt
git commit -q -m "Уменьшен таймаут"
echo "retries = 3" > retries.txt
git add retries.txt
git commit -q -m "Повторы запросов"
git switch -q main
echo "timeout = 60" > settings.txt
git add settings.txt
git commit -q -m "Увеличен таймаут"
git switch -q fast
git rebase main || echo
```

```sh solution
echo "timeout = 10" > settings.txt
git add settings.txt
git rebase --continue
```

## task git-rebase-shared-quiz

```json
{
  "type": "choice",
  "title": "Общая ветка",
  "xp": 10,
  "hints": [
    "Раздел «Когда rebase делать нельзя».",
    "Rebase заменяет коммиты новыми. Что случится у коллеги, у которого остались старые?"
  ],
  "options": [
    "Перебазировать `feature/login` на `main`: так история будет прямой",
    "Не перебазировать: принять изменения `main` в `feature/login` обычным слиянием",
    "Удалить `feature/login` через `git branch -D` и сделать работу заново",
    "Перебазировать `main` на `feature/login`"
  ],
  "answer": [1],
  "explanation": "Ветку `feature/login` уже забрал коллега. Rebase заменил бы её коммиты новыми, и у коллеги остались бы старые: истории разойдутся, появятся дубли и лишние конфликты. Общую ветку обновляют слиянием (`git merge main`) — оно ничего не переписывает. Перебазировать `main` ещё хуже: это главная общая ветка. Удалять ветку с готовой работой незачем: слияние решает задачу без потерь."
}
```

Вы и коллега вместе работаете в ветке `feature/login`: коллега уже забрал её к себе и продолжает коммитить. Тем временем в `main` появились важные исправления, и их нужно получить в `feature/login`. Как поступить?
