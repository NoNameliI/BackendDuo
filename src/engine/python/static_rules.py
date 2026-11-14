"""Static checks of a learner project: the code is parsed with ast and never executed.

analyze(project_json, rules_json) -> json {"problems": [str]}. Every message is Russian and names file:line where
it can; a rule's own "message" replaces the default text.
"""
import ast
import fnmatch
import json
import io
import re
import tokenize

_OFFLOAD = {"to_thread", "run_in_executor", "run_in_threadpool", "run_sync"}
_TEST_IMPORTS = ["pytest", "fastapi", "httpx", "starlette.testclient", "json", "typing", "datetime", "decimal", "uuid", "re", "enum", "dataclasses"]
_TEST_NAMES = {"open", "exec", "eval", "compile", "__import__", "globals", "vars", "__builtins__", "builtins", "inspect", "sys", "os", "importlib", "__file__", "__code__"}
_ROUTE_METHODS = {"get", "post", "put", "delete", "patch", "options", "head", "trace", "api_route", "route", "websocket"}
_DEFAULT_BLOCKING = [
    "time.sleep",
    "requests.*",
    "httpx.Client",
    "httpx.get",
    "httpx.post",
    "httpx.put",
    "httpx.patch",
    "httpx.delete",
    "httpx.head",
    "httpx.request",
    "urllib.request.urlopen",
]
_SCOPES = (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda, ast.ClassDef)


def _dotted(node):
    """a.b.c for names and attribute chains, else None."""
    parts = []
    while isinstance(node, ast.Attribute):
        parts.append(node.attr)
        node = node.value
    if isinstance(node, ast.Name):
        parts.append(node.id)
        return ".".join(reversed(parts))
    return None


def _aliases(tree):
    """Local name -> full dotted name it was imported as."""
    out = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for a in node.names:
                if a.asname:
                    out[a.asname] = a.name
                else:
                    first = a.name.split(".")[0]
                    out[first] = first
        elif isinstance(node, ast.ImportFrom) and node.module and not node.level:
            for a in node.names:
                if a.name != "*":
                    out[a.asname or a.name] = node.module + "." + a.name
    return out


def _resolve(node, aliases):
    name = _dotted(node)
    if name is None:
        return None
    head, _, rest = name.partition(".")
    full = aliases.get(head, head)
    return full + ("." + rest if rest else "")


def _module_of(path):
    mod = path[:-3] if path.endswith(".py") else path
    mod = mod.replace("/", ".")
    return mod[: -len(".__init__")] if mod.endswith(".__init__") else mod


def _same_file(path, wanted):
    wanted = wanted.replace("\\", "/").lstrip("./")
    return path == wanted or path.endswith("/" + wanted)


class _Prune(ast.NodeTransformer):
    """Empties branches that can never run (`if False:`, `if 0:`, and the else of `if True:`)."""

    def visit_If(self, node):
        self.generic_visit(node)
        if isinstance(node.test, ast.Constant):
            if node.test.value:
                node.orelse = []
            else:
                node.body = [ast.copy_location(ast.Pass(), node)]
        return node


def _is_test_path(path):
    return path.startswith("tests/") or "/tests/" in path


class _Project:
    def __init__(self, files, entry):
        self.files = files
        self.entry = entry
        self.trees = {}
        self.syntax = []
        for path in sorted(files):
            if not path.endswith(".py"):
                continue
            try:
                self.trees[path] = _Prune().visit(ast.parse(files[path], filename=path))
            except SyntaxError as e:
                self.syntax.append("%s:%s: синтаксическая ошибка: %s" % (path, e.lineno or 1, e.msg))
            except (ValueError, RecursionError):
                self.syntax.append("%s:1: файл не удалось разобрать" % path)
        self.aliases = {p: _aliases(t) for p, t in self.trees.items()}

    def select(self, file):
        return [p for p in self.trees if not file or _same_file(p, file)]

    def module_path(self, module):
        base = module.replace(".", "/")
        for candidate in (base + ".py", base + "/__init__.py"):
            if candidate in self.trees:
                return candidate
        return None

    def imported(self, path):
        """Project files the file imports (parent packages and `from pkg import module` included)."""
        out = set()

        def add(module):
            parts = module.split(".") if module else []
            for i in range(1, len(parts) + 1):
                found = self.module_path(".".join(parts[:i]))
                if found:
                    out.add(found)

        for node in ast.walk(self.trees[path]):
            if isinstance(node, ast.Import):
                for a in node.names:
                    add(a.name)
            elif isinstance(node, ast.ImportFrom):
                base = node.module or ""
                if node.level:
                    pkg = path.split("/")[:-1]
                    pkg = pkg[: len(pkg) - (node.level - 1)] if node.level > 1 else pkg
                    base = ".".join(pkg + ([node.module] if node.module else []))
                add(base)
                for a in node.names:
                    add(base + "." + a.name if base else a.name)
        out.discard(path)
        return out

    def reachable(self):
        """Files reachable from the entry module by project-local imports, tests excluded (all non-test files without an entry)."""
        if self.entry not in self.trees:
            return [p for p in self.trees if not _is_test_path(p)]
        seen = [self.entry]
        for path in seen:
            for nxt in sorted(self.imported(path)):
                if nxt not in seen:
                    seen.append(nxt)
        return [p for p in seen if not _is_test_path(p)]

    def scope(self, file):
        return self.select(file) if file else self.reachable()


def _msg(rule, default):
    text = rule.get("message")
    return text if isinstance(text, str) and text.strip() else default


def _where(file):
    return " в файле %s" % file if file else ""


def _rule_uses(project, rule):
    name = str(rule.get("name", ""))
    for path in project.scope(rule.get("file")):
        for node in ast.walk(project.trees[path]):
            if isinstance(node, ast.Name) and node.id == name:
                return []
            if isinstance(node, ast.Attribute):
                dotted = _dotted(node)
                if node.attr == name or (dotted and (dotted == name or dotted.endswith("." + name))):
                    return []
            if isinstance(node, ast.keyword) and node.arg == name:
                return []
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) and node.name == name:
                return []
    return [_msg(rule, "Не найдено использование «%s»%s." % (name, _where(rule.get("file"))))]


def _rule_imports(project, rule):
    module = str(rule.get("module", ""))
    name = rule.get("name")
    for path in project.scope(None):
        for node in ast.walk(project.trees[path]):
            if isinstance(node, ast.Import):
                if not name and any(a.name == module or a.name.startswith(module + ".") for a in node.names):
                    return []
            elif isinstance(node, ast.ImportFrom) and node.module and not node.level:
                if node.module == module or node.module.startswith(module + "."):
                    if not name or any(a.name in (name, "*") for a in node.names):
                        return []
    what = "from %s import %s" % (module, name) if name else "import %s" % module
    return [_msg(rule, "Не найден импорт «%s»." % what)]


def _body_calls(body, aliases):
    """Calls in a function body: nested defs and classes are other scopes; lambdas count unless they are handed
    to a thread offload (asyncio.to_thread, run_in_executor, run_in_threadpool)."""
    stack = list(body)
    while stack:
        node = stack.pop()
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            continue
        children = list(ast.iter_child_nodes(node))
        if isinstance(node, ast.Call):
            yield node
            if (_dotted(node.func) or "").split(".")[-1] in _OFFLOAD:
                children = [c for c in children if not isinstance(c, ast.Lambda)]
        stack.extend(children)


def _local_aliases(tree, aliases):
    """Import aliases plus simple assignments such as `s = time.sleep`."""
    out = dict(aliases)
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and isinstance(node.value, (ast.Name, ast.Attribute)):
            full = _resolve(node.value, out)
            if full:
                for t in node.targets:
                    if isinstance(t, ast.Name):
                        out[t.id] = full
    return out


def _rule_no_blocking(project, rule):
    patterns = rule.get("calls") or _DEFAULT_BLOCKING
    out = []
    for path in project.select(rule.get("file")):
        tree = project.trees[path]
        aliases = _local_aliases(tree, project.aliases[path])
        helpers = {n.name: n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef)}

        def blocked(call):
            full = _resolve(call.func, aliases)
            return full if full and any(fnmatch.fnmatchcase(full, p) for p in patterns) else None

        for node in ast.walk(tree):
            if not isinstance(node, ast.AsyncFunctionDef):
                continue
            for call in sorted(_body_calls(node.body, aliases), key=lambda c: c.lineno):
                full = blocked(call)
                if full:
                    out.append(_msg(rule, "%s:%s: блокирующий вызов %s(...) внутри async def %s; он остановит весь сервер." % (path, call.lineno, full, node.name)))
                    continue
                helper = helpers.get(call.func.id) if isinstance(call.func, ast.Name) else None
                if helper is None:
                    continue
                for inner in sorted(_body_calls(helper.body, aliases), key=lambda c: c.lineno):
                    full = blocked(inner)
                    if full:
                        out.append(_msg(rule, "%s:%s: блокирующий вызов %s(...) в функции %s, которую вызывает async def %s; он остановит весь сервер." % (path, inner.lineno, full, helper.name, node.name)))
    out = list(dict.fromkeys(out))
    return out[:1] if rule.get("message") else out


def _routes(tree):
    """(function, decorator call, router variable) for every route decorator."""
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for dec in node.decorator_list:
                if isinstance(dec, ast.Call) and isinstance(dec.func, ast.Attribute) and dec.func.attr in _ROUTE_METHODS:
                    owner = _dotted(dec.func.value)
                    if owner:
                        yield node, dec, owner


def _rule_router(project, rule):
    file = str(rule.get("file", ""))
    paths = project.select(file)
    if not paths:
        return [_msg(rule, "Файл %s не найден." % file)]
    path = paths[0]
    tree = project.trees[path]
    names = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and isinstance(node.value, ast.Call):
            if (_dotted(node.value.func) or "").split(".")[-1] == "APIRouter":
                names.update(t.id for t in node.targets if isinstance(t, ast.Name))
        elif isinstance(node, ast.AnnAssign) and isinstance(node.value, ast.Call) and isinstance(node.target, ast.Name):
            if (_dotted(node.value.func) or "").split(".")[-1] == "APIRouter":
                names.add(node.target.id)
    if not names:
        return [_msg(rule, "%s: не создан APIRouter." % path)]
    if not any(owner in names for _, _, owner in _routes(tree)):
        return [_msg(rule, "%s: у APIRouter нет ни одного маршрута." % path)]
    wanted = {"%s.%s" % (_module_of(path), n) for n in names}
    entry = project.entry if project.entry in project.trees else None
    if entry is None:
        return [_msg(rule, "Не найден главный файл приложения.")]
    for node in ast.walk(project.trees[entry]):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "include_router" and node.args:
            if _resolve(node.args[0], project.aliases[entry]) in wanted:
                return []
    return [_msg(rule, "Роутер из %s не подключён: в %s нет app.include_router(...) с ним." % (path, entry))]


def _classes(project):
    """class name -> [(path, ClassDef)]; later same-named classes are kept too."""
    out = {}
    for path, tree in project.trees.items():
        for node in ast.walk(tree):
            if isinstance(node, ast.ClassDef):
                out.setdefault(node.name, []).append((path, node))
    return out


def _model_names(node, aliases):
    """Class names an annotation or response_model expression points at."""
    if node is None or isinstance(node, ast.Constant):
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            return [node.value.split(".")[-1].strip("'\" ")]
        return []
    if isinstance(node, (ast.Name, ast.Attribute)):
        full = _resolve(node, aliases) or ""
        return [full.split(".")[-1]]
    if isinstance(node, ast.Subscript):
        return _model_names(node.slice, aliases)
    if isinstance(node, ast.Tuple):
        return [n for e in node.elts for n in _model_names(e, aliases)]
    if isinstance(node, ast.BinOp):
        return _model_names(node.left, aliases) + _model_names(node.right, aliases)
    return []


def _fields(classes, name, seen, found):
    """Field names of a project class, its project bases and the project models its fields mention."""
    if name in seen:
        return
    seen.add(name)
    for path, cls in classes.get(name, []):
        for stmt in cls.body:
            if isinstance(stmt, ast.AnnAssign) and isinstance(stmt.target, ast.Name):
                found.setdefault(stmt.target.id, name)
                for inner in _model_names(stmt.annotation, {}):
                    _fields(classes, inner, seen, found)
        for base in cls.bases:
            for b in _model_names(base, {}):
                _fields(classes, b, seen, found)


def _rule_hides(project, rule):
    field = str(rule.get("field", ""))
    classes = _classes(project)
    out = []
    for path, tree in project.trees.items():
        aliases = project.aliases[path]
        for func, dec, _ in _routes(tree):
            exprs = [kw.value for kw in dec.keywords if kw.arg == "response_model"]
            if func.returns is not None:
                exprs.append(func.returns)
            for expr in exprs:
                for name in _model_names(expr, aliases):
                    found = {}
                    _fields(classes, name, set(), found)
                    if field in found:
                        out.append(_msg(rule, "%s:%s: модель ответа %s отдаёт поле «%s» (описано в %s)." % (path, func.lineno, name, field, found[field])))
    return out[:3] if not rule.get("message") else out[:1]


def _env_default(v):
    """The literal default of os.getenv(name, 'x') / os.environ.get(name, 'x'), else None."""
    if not isinstance(v, ast.Call):
        return None
    tail = (_dotted(v.func) or "").split(".")
    if tail[-1] not in ("getenv", "get") or (tail[-1] == "get" and tail[-2:-1] != ["environ"]):
        return None
    if len(v.args) > 1:
        return v.args[1]
    for kw in v.keywords:
        if kw.arg == "default":
            return kw.value
    return None


def _literal(v):
    if isinstance(v, ast.Constant):
        return isinstance(v.value, (str, bytes)) and len(v.value) > 0
    if isinstance(v, ast.JoinedStr):
        return len(v.values) > 0
    if isinstance(v, ast.BinOp) and isinstance(v.op, ast.Add):
        return _literal(v.left) and _literal(v.right)
    default = _env_default(v)
    return default is not None and _literal(default)


def _rule_secret(project, rule):
    wanted = {str(n).lower() for n in rule.get("names", [])}
    out = []

    def hit(path, line, name):
        out.append(_msg(rule, "%s:%s: значение «%s» записано в коде; возьмите его из переменной окружения." % (path, line, name)))

    def target_name(t):
        return t.id if isinstance(t, ast.Name) else t.attr if isinstance(t, ast.Attribute) else None

    for path, tree in project.trees.items():
        for node in ast.walk(tree):
            if isinstance(node, ast.Assign) and _literal(node.value):
                for t in node.targets:
                    n = target_name(t)
                    if n and n.lower() in wanted:
                        hit(path, node.lineno, n)
            elif isinstance(node, ast.AnnAssign) and node.value is not None and _literal(node.value):
                n = target_name(node.target)
                if n and n.lower() in wanted:
                    hit(path, node.lineno, n)
            elif isinstance(node, ast.keyword) and node.arg and node.arg.lower() in wanted and _literal(node.value):
                hit(path, node.value.lineno, node.arg)
            elif isinstance(node, ast.Dict):
                for k, v in zip(node.keys, node.values):
                    if isinstance(k, ast.Constant) and isinstance(k.value, str) and k.value.lower() in wanted and _literal(v):
                        hit(path, v.lineno, k.value)
            elif isinstance(node, ast.Call) and _literal(node) and not isinstance(node, ast.Constant):
                first = node.args[0] if node.args else None
                if isinstance(first, ast.Constant) and isinstance(first.value, str) and first.value.lower() in wanted:
                    hit(path, node.lineno, first.value)
    out = list(dict.fromkeys(out))
    return out[:1] if rule.get("message") else out


def _strip_comments(text):
    """The source without comments (strings stay); unchanged when it cannot be tokenized."""
    lines = text.splitlines(True)
    try:
        for tok in tokenize.generate_tokens(io.StringIO(text).readline):
            if tok.type == tokenize.COMMENT:
                row = tok.start[0] - 1
                lines[row] = lines[row][: tok.start[1]] + lines[row][tok.end[1]:]
    except (tokenize.TokenError, IndentationError, SyntaxError):
        return text
    return "".join(lines)


def _rule_pattern(project, rule):
    try:
        rx = re.compile(str(rule.get("regex", "")), re.MULTILINE)
    except re.error:
        return [_msg(rule, "Правило pattern содержит неверное регулярное выражение.")]
    default = "Код не соответствует требованию (%s)."
    found = []
    for path in sorted(project.files):
        if not path.endswith(".py"):
            continue
        source = _strip_comments(project.files[path])
        m = rx.search(source)
        if m:
            found.append((path, source.count("\n", 0, m.start()) + 1))
    if rule.get("forbid"):
        if found:
            path, line = found[0]
            return [_msg(rule, "%s:%s: запрещённая конструкция." % (path, line))]
        return []
    return [] if found else [_msg(rule, default % rule.get("regex", ""))]


def _rule_tests_api_only(project, rule):
    """Tests may reach the app only through its public API: a short list of modules, no files, no introspection."""
    out = []
    for path in sorted(project.trees):
        if not _is_test_path(path):
            continue
        imported = set(project.aliases[path])
        for node in ast.walk(project.trees[path]):
            modules = []
            if isinstance(node, ast.Import):
                modules = [a.name for a in node.names]
            elif isinstance(node, ast.ImportFrom):
                if node.level:
                    continue
                modules = [node.module or ""]
            for m in modules:
                if any(m == a or m.startswith(a + ".") for a in _TEST_IMPORTS):
                    continue
                if any(project.module_path(".".join(m.split(".")[: i + 1])) for i in range(len(m.split(".")))):
                    continue
                out.append("%s:%s: в тестах нельзя импортировать «%s»; используйте TestClient и публичный API приложения." % (path, node.lineno, m))
            if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Load) and node.id in _TEST_NAMES:
                out.append("%s:%s: в тестах нельзя использовать «%s»." % (path, node.lineno, node.id))
            elif isinstance(node, ast.Attribute) and node.attr in ("__builtins__", "__code__", "__globals__", "__import__"):
                out.append("%s:%s: в тестах нельзя обращаться к «%s»." % (path, node.lineno, node.attr))
            elif isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in ("getattr", "setattr", "delattr"):
                if node.args and isinstance(node.args[0], ast.Name) and node.args[0].id in imported:
                    out.append("%s:%s: в тестах нельзя менять и читать модули через %s." % (path, node.lineno, node.func.id))
    out = list(dict.fromkeys(out))
    return [_msg(rule, out[0])] if rule.get("message") and out else out


_RULES = {
    "uses": _rule_uses,
    "imports": _rule_imports,
    "no-blocking-in-async": _rule_no_blocking,
    "router": _rule_router,
    "response-model-hides": _rule_hides,
    "no-literal-secret": _rule_secret,
    "pattern": _rule_pattern,
    "tests-api-only": _rule_tests_api_only,
}


def analyze(project_json, rules_json):
    project = json.loads(project_json)
    files = {str(k): str(v) for k, v in project.get("files", {}).items()}
    p = _Project(files, project.get("entry") or "main.py")
    if p.syntax:
        return json.dumps({"problems": p.syntax[:3]}, ensure_ascii=False)
    problems = []
    for rule in json.loads(rules_json):
        fn = _RULES.get(rule.get("rule"))
        if fn is None:
            problems.append("Неизвестное правило проверки: %s." % rule.get("rule"))
        else:
            problems.extend(fn(p, rule))
    return json.dumps({"problems": problems}, ensure_ascii=False)
