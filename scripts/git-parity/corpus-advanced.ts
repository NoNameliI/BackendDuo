/** Stage 3 scenarios: history operations and remotes. Same format as corpus.ts. */
const BASE = `git init -q repo
cd repo
cat > app.txt <<'EOF'
title
one
two
three
EOF
git add app.txt
git commit -q -m "Start"`;

export const advanced: Record<string, string> = {
  'merge fast-forward and already up to date': `
${BASE}
git switch -q -c feature
echo four >> app.txt
echo new > new.txt
git add .
git commit -q -m "Feature"
git switch -q main
git merge feature
git merge feature
git log --oneline --graph --all
git reflog
`,
  'merge three-way clean': `
${BASE}
git switch -q -c feature
echo f > f.txt
git add f.txt
git commit -q -m "Add f"
git switch -q main
echo m > m.txt
git add m.txt
git commit -q -m "Add m"
git merge feature
git log --oneline --graph
git log --graph -3
git show --stat HEAD
`,
  'merge conflict and resolution': `
${BASE}
git switch -q -c feature
cat > app.txt <<'EOF'
title
one
TWO from feature
three
EOF
git commit -q -am "Feature edit"
git switch -q main
cat > app.txt <<'EOF'
title
one
two from main
three
EOF
git commit -q -am "Main edit"
git merge feature
git status
git status -s
cat app.txt
git commit -m "try"
echo resolved > app.txt
git add app.txt
git status
git commit --no-edit
git log --oneline --graph
`,
  'merge abort, no-ff, ff-only, into other branch': `
${BASE}
git switch -q -c feature
echo x >> app.txt
git commit -q -am "X"
git switch -q -c dev main
echo y >> app.txt
git commit -q -am "Y"
git merge --ff-only feature
git merge feature
git merge --abort
git status
git merge --abort
git switch -q main
git merge --no-ff feature -m "Merge feature work"
git log --oneline --graph --all
`,
  'merge with dirty worktree and modify/delete': `
${BASE}
git switch -q -c feature
git rm -q app.txt
git commit -q -m "Remove app"
git switch -q main
echo edit >> app.txt
git commit -q -am "Edit app"
git merge feature
git status
`,
  'rebase clean': `
${BASE}
git switch -q -c feature
echo a > a.txt
git add a.txt
git commit -q -m "A"
echo b > b.txt
git add b.txt
git commit -q -m "B"
git switch -q main
echo m > m.txt
git add m.txt
git commit -q -m "M"
git switch -q feature
git rebase main
git log --oneline --graph --all
git rebase main
git reflog -5
`,
  'rebase conflict continue and abort': `
${BASE}
git switch -q -c feature
cat > app.txt <<'EOF'
title
ONE
two
three
EOF
git commit -q -am "Upper one"
git switch -q main
cat > app.txt <<'EOF'
title
uno
two
three
EOF
git commit -q -am "Uno"
git switch -q feature
git rebase main
git status
git rebase --abort
git log --oneline
git rebase main
echo fixed > app.txt
git add app.txt
git rebase --continue
git log --oneline --graph --all
`,
  'reset modes': `
${BASE}
echo 1 >> app.txt
git commit -q -am "C1"
echo 2 >> app.txt
git commit -q -am "C2"
git reset --soft HEAD~1
git status -s
git reset HEAD~1
git status -s
git reset --hard
git status
echo 3 >> app.txt
git add app.txt
git reset app.txt
git status -s
git reset --hard HEAD
git log --oneline
git reset --hard ORIG_HEAD
git reflog
`,
  'revert and cherry-pick': `
${BASE}
echo bug > bug.txt
git add bug.txt
git commit -q -m "Add bug"
git revert --no-edit HEAD
git log --oneline
git show HEAD
git switch -q -c hotfix HEAD~2
echo fix > fix.txt
git add fix.txt
git commit -q -m "Fix"
git switch -q main
git cherry-pick hotfix
git log --oneline --graph --all
git cherry-pick hotfix
`,
  'cherry-pick conflict': `
${BASE}
git switch -q -c other
echo other > app.txt
git commit -q -am "Other"
git switch -q main
echo mine > app.txt
git commit -q -am "Mine"
git cherry-pick other
git status
echo both > app.txt
git add app.txt
git cherry-pick --continue
git log --oneline
`,
  'stash': `
${BASE}
echo wip >> app.txt
echo note > note.txt
git stash
git status -s
git stash -u -m "with note"
git stash list
git status
git stash pop
git stash list
git stash apply
git stash drop
git stash list
git stash pop
git status -s
`,
  'tags and reflog': `
${BASE}
git tag v0.1
echo more >> app.txt
git commit -q -am "More"
git tag -a v1.0 -m "First release"
git tag
git tag -l "v1*"
git log --oneline --decorate
git show v1.0
git tag v1.0
git tag -d v0.1
git tag
git reflog
git log -g --oneline
`,
  'clone push fetch pull': `
git init -q --bare /srv/origin.git
git clone /srv/origin.git site
cd site
echo hello > index.html
git add index.html
git commit -q -m "Home page"
git push
git push -u origin main
git status
git branch -vv
git remote -v
cd ..
git clone /srv/origin.git other
cd other
echo news > news.html
git add news.html
git commit -q -m "News"
git push
cd ../site
git fetch
git status
git log --oneline --graph --all
git pull
git log --oneline
`,
  'push rejected and pull merge': `
git init -q --bare /srv/team.git
git clone -q /srv/team.git alice
cd alice
echo a > a.txt
git add a.txt
git commit -q -m "Alice 1"
git push -q -u origin main
cd ..
git clone -q /srv/team.git bob
cd bob
echo b > b.txt
git add b.txt
git commit -q -m "Bob 1"
git push -q
cd ../alice
echo a2 >> a.txt
git commit -q -am "Alice 2"
git push
git pull --no-edit
git status
git push -q
git switch -q -c topic
git push -u origin topic
git push origin --delete topic
git remote add backup /srv/team.git
git remote
git remote remove backup
git remote
`,
  // The merge message of a pull names the remote's absolute path, so pull --rebase shows hashes instead.
  'pull rebase and branch listing': `
git init -q --bare /srv/shop.git
git clone -q /srv/shop.git one
cd one
echo a > a.txt
git add a.txt
git commit -q -m "One"
git push -q -u origin main
cd ..
git clone -q /srv/shop.git two
cd two
echo b > b.txt
git add b.txt
git commit -q -m "Two"
git push -q
cd ../one
echo c > c.txt
git add c.txt
git commit -q -m "Three"
git status -sb
git fetch
git status -sb
git branch -vv
git branch -a
git pull --rebase
git log --oneline --graph --all
git push
git branch -vv
`,
};
