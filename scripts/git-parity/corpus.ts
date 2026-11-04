/**
 * Scripts run both in the sandbox and in real git; their output must match. Lines are shell commands
 * (the sandbox's mini shell subset); `cmd <<'EOF'` takes the following lines up to EOF.
 */
export const corpus: Record<string, string> = {
  'init and first commit': `
git init site
cd site
git status
echo "# Site" > README.md
git status
git add README.md
git status
git commit -m "Add README"
git status
git log
`,
  'staged, unstaged and untracked': `
git init -q app
cd app
echo one > a.txt
echo two > b.txt
mkdir docs
echo guide > docs/guide.md
git add a.txt b.txt
git commit -q -m "Initial files"
echo more >> a.txt
rm b.txt
echo c > c.txt
git add c.txt
echo extra > notes.txt
git status
git status -s
git diff
git diff --staged
git diff --name-only
`,
  'commit summary variants': `
git init -q repo
cd repo
cat > list.txt <<'EOF'
alpha
beta
gamma
EOF
git add .
git commit -m "List"
cat > list.txt <<'EOF'
alpha
BETA
gamma
delta
EOF
git commit -am "Update list"
git rm -q list.txt
echo x > new.txt
git add new.txt
git commit -m "Replace list"
git log --oneline
git show HEAD~1
`,
  'nothing to commit and errors': `
git init -q w
cd w
git commit -m "empty"
echo a > a.txt
git commit -m "untracked only"
git add missing.txt
git log
git add a.txt
git commit -q -m "First"
git commit -m "again"
git frobnicate
`,
  'branches and switch': `
git init -q proj
cd proj
echo base > file.txt
git add file.txt
git commit -q -m "Base"
git branch feature
git branch
git switch feature
echo feature >> file.txt
git commit -q -am "Feature work"
git switch main
git branch -v
git switch -c hotfix
echo fix > fix.txt
git add fix.txt
git commit -q -m "Hotfix"
git log --oneline --all
git log --oneline --graph --all
git log --graph --all -2
git branch -d feature
git branch -D feature
git branch
`,
  'switch with local changes': `
git init -q s
cd s
echo v1 > f.txt
git add f.txt
git commit -q -m "v1"
git switch -c other
echo v2 > f.txt
git commit -q -am "v2"
git switch main
echo local > f.txt
git switch other
git restore f.txt
git switch other
git switch -
git switch main
git switch nope
`,
  'detached head': `
git init -q d
cd d
echo 1 > n.txt
git add n.txt
git commit -q -m "one"
echo 2 > n.txt
git commit -q -am "two"
git switch --detach HEAD~1
git status
git log --oneline --all
git switch main
git switch -q -c quiet
git checkout -q main
git switch -q nope
`,
  'restore and rm --cached': `
git init -q r
cd r
echo keep > k.txt
echo temp > t.txt
git add .
git commit -q -m "Files"
echo changed > k.txt
git add k.txt
git restore --staged k.txt
git status --short
git restore k.txt
git rm --cached t.txt
git status
echo t.txt > .gitignore
git status --short
`,
  'gitignore and add': `
git init -q g
cd g
cat > .gitignore <<'EOF'
*.log
build/
EOF
echo log > debug.log
mkdir build
echo bin > build/app
echo src > main.c
git status
git add debug.log
git add .
git status --short
`,
  'mv and rename detection': `
git init -q m
cd m
echo content > old.txt
git add old.txt
git commit -q -m "Old"
git mv old.txt new.txt
git status
git commit -m "Rename"
git log --oneline
`,
  'amend and multi-paragraph message': `
git init -q a
cd a
echo x > x.txt
git add x.txt
git commit -q -m "Frist" -m "Body line."
git commit --amend -m "First" -m "Body line."
git log
`,
  'config and aliases': `
git init -q c
cd c
git config user.name "Other Person"
git config user.name
git config alias.st "status --short"
echo a > a
git st
git add a
git commit -q -m "By other"
git log
`,
  'subdirectory paths': `
git init -q sub
cd sub
mkdir -p src/lib
echo a > src/lib/a.js
echo b > src/b.js
echo r > root.txt
cd src
git status
git add .
git status
git commit -q -m "Sources"
echo changed > lib/a.js
echo r2 > ../root.txt
git status
git diff
git add ../root.txt
git status -s
cd ..
git status
`,
  'diff hunks': `
git init -q h
cd h
cat > poem.txt <<'EOF'
line 1
line 2
line 3
line 4
line 5
line 6
line 7
line 8
line 9
line 10
line 11
line 12
line 13
line 14
line 15
EOF
git add poem.txt
git commit -q -m "Poem"
cat > poem.txt <<'EOF'
line 1 changed
line 2
line 3
line 4
line 5
line 6
line 7
line 8
line 9
line 10
line 11
line 12
line 13
line 15
line 16
EOF
git diff
git diff --stat
git commit -q -am "Edit poem"
git show --stat
git diff HEAD~1 HEAD
`,
  'checkout and branch management': `
git init -q co
cd co
echo 1 > one.txt
git add one.txt
git commit -q -m "One"
git checkout -b dev
echo 2 > two.txt
git add two.txt
git commit -q -m "Two"
git checkout main
git checkout dev
git branch -m dev develop
git branch
git branch bad..name
git branch develop
git checkout -b develop
git checkout HEAD~1
git checkout develop
echo junk > one.txt
git checkout -- one.txt
git status
git log -n 1 --oneline
git log -1
`,
  'rm and restore edge cases': `
git init -q e
cd e
echo a > a.txt
mkdir d
echo b > d/b.txt
git add .
git commit -q -m "Init"
echo changed > a.txt
git rm a.txt
git rm d
git rm -r d
git status
git restore --staged d/b.txt
git restore d/b.txt
git restore --source HEAD a.txt
git status --short
git rm nothing.txt
git restore nothing.txt
`,
  'init variants': `
git init proj
cd proj
git init
git status
cd ..
git init --bare srv.git
git status
`,
};
