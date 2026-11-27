#!/usr/bin/env python3
"""Apply the shared MODNA design to the existing pages.

Only the <head> styles and a few bits of static markup change; page logic stays as it was.
Every replacement is asserted so a silent miss cannot slip through.
Usage: python3 -I restyle.py <repo dir>
"""
import re
import sys
from pathlib import Path

repo = Path(sys.argv[1])

HEAD_LINKS = '''  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="app.css?v=1">'''

SHELL = {
    'side': ['manage-stock.html', 'order-history.html', 'report.html', 'audit-log.html',
             'superadmin-dashboard.html', 'user-management.html'],
    'top': ['dashboard-pluser.html', 'dashboard-ukuser.html', 'dashboard-uk-stock.html',
            'dashboard-monika.html', 'manage-pl-stock.html', 'order-history-pl.html',
            'order-history-uk.html'],
    'auth': ['index.html', 'wait-for-role.html'],
}

BRAND_ADMIN = '<div class="brand"><span class="brand-name">MODNA LASH</span><span class="brand-sub">WAREHOUSE</span></div>'
BRAND_SUPER = '<div class="brand"><span class="brand-name">MODNA LASH</span><span class="brand-sub">SUPER ADMIN</span></div>'

ADMIN_NAV = '''<nav class="sidebar">
      {brand}
      <a href="dashboard-admin.html">Dashboard</a>
      <a href="manage-stock.html">Manage Stock</a>
      <a href="order-history.html">Order History</a>
      <a href="report.html" class="active">Report</a>
      <a href="index.html" onclick="window.__sb.auth.signOut().finally(function(){{location.href='index.html'}});return false;">Log out</a>
    </nav>'''.format(brand=BRAND_ADMIN)

SIGNOUT_SB = '''<a href="index.html" onclick="window.__sb.auth.signOut().finally(function(){location.href='index.html'});return false;">Log out</a>'''
PILL_TD = '<td><span class="pill pill-${String(i.status).toLowerCase()}">${i.status}</span></td>'
FULFILLED_OLD = "${allFulfilled ? ' - ✅ Fulfilled' : ''}"
FULFILLED_NEW = "${allFulfilled ? ' <span class=\"pill pill-fulfilled\">Fulfilled</span>' : ''}"


def sub(text, old, new, count=1, name=''):
    n = text.count(old)
    assert n == count, f'{name}: expected {count} of {old!r}, found {n}'
    return text.replace(old, new)


def wrap_table(text, table_id, name):
    pat = re.compile(r'([ \t]*)<table id="%s">.*?</table>' % re.escape(table_id), re.S)
    m = pat.search(text)
    assert m, f'{name}: table #{table_id} not found'
    indent = m.group(1)
    block = m.group(0)
    return text[:m.start()] + f'{indent}<div class="table-wrap">\n{block}\n{indent}</div>' + text[m.end():]


def restyle_head(text, shell, name):
    head_end = text.index('</head>')
    head, rest = text[:head_end], text[head_end:]
    head, n = re.subn(r'[ \t]*<style>.*?</style>\n?', '', head, flags=re.S)
    assert n == 1, f'{name}: expected one <style> in head, found {n}'
    head = re.sub(r'[ \t]*<!--[^>]*Font[^>]*-->\n', '', head)
    head = re.sub(r'[ \t]*<link[^>]*fonts\.googleapis\.com[^>]*>\n', '', head)
    if 'name="viewport"' not in head:
        head = head.replace('<title>', '<meta name="viewport" content="width=device-width, initial-scale=1.0"/>\n  <title>', 1)
    head = head.rstrip('\n') + '\n' + HEAD_LINKS + '\n'
    text = head + rest
    n = len(re.findall(r'<body[^>]*>', text))
    assert n >= 1, f'{name}: no <body> found'
    return re.sub(r'<body[^>]*>', f'<body class="app shell-{shell}">', text, count=1)


def page_edits(name, t):
    if name == 'manage-stock.html':
        t = sub(t, '<h2>MODNA Admin</h2>', BRAND_ADMIN, name=name)
        t = sub(t, '<a href="index.html">Logout</a>', SIGNOUT_SB, name=name)
        t = sub(t, '📁 Export CSV', 'Export CSV', name=name)
        t = sub(t, '🗑️ Delete', 'Delete', name=name)
        t = sub(t, '<div id="successMsg" style="color:#7ee2f6;margin-top:10px;"></div>',
                '<div id="successMsg" class="msg-ok"></div>', name=name)
        t = wrap_table(t, 'stockTable', name)
    elif name == 'order-history.html':
        t = sub(t, '<h2>MODNA Admin</h2>', BRAND_ADMIN, name=name)
        t = sub(t, '<a href="index.html">Logout</a>', SIGNOUT_SB, name=name)
        t = sub(t, '<p style="color:#f66">Error loading orders</p>', '<p class="error-text">Error loading orders</p>', name=name)
        t = sub(t, '<td>${i.status}</td>', PILL_TD, count=2, name=name)
        t = sub(t, FULFILLED_OLD, FULFILLED_NEW, name=name)
        t = sub(t, "✔ ${allFulfilled ? 'Done' : 'Fulfill'}", "${allFulfilled ? 'Done' : 'Fulfill'}", name=name)
        t = sub(t, '🖨 Print', 'Print', name=name)
    elif name in ('order-history-pl.html', 'order-history-uk.html'):
        t = sub(t, '<p style="color:#f66">Error loading orders</p>', '<p class="error-text">Error loading orders</p>', name=name)
        t = sub(t, '<td>${i.status}</td>', PILL_TD, count=2, name=name)
        t = sub(t, FULFILLED_OLD, FULFILLED_NEW, name=name)
        t = sub(t, '''<button class="logout-btn" onclick="location.href='index.html'">Logout</button>''',
                '''<button class="logout-btn" onclick="supabaseClient.auth.signOut().finally(function(){location.href='index.html'})">Log out</button>''', name=name)
        if name == 'order-history-uk.html':
            t = sub(t, '<header>\n', '<header>\n    <h1>MODNA Warehouse</h1>\n', name=name)
    elif name == 'report.html':
        t = sub(t, '''  <div class="container">
    <a href="dashboard-admin.html" class="back-btn">⬅ Back to Dashboard</a>
    <h1>Inventory Report</h1>
''', '''  <div class="container">
    %s
    <main class="main">
    <div class="header">Inventory Report</div>
''' % ADMIN_NAV, name=name)
        t = wrap_table(t, 'reportTable', name)
        t = sub(t, '''    <canvas id="categoryChart" height="80"></canvas>
  </div>
''', '''    <div class="section">
      <h3>By category</h3>
      <canvas id="categoryChart" height="80"></canvas>
    </div>
    </main>
  </div>
''', name=name)
    elif name in ('audit-log.html', 'superadmin-dashboard.html', 'user-management.html'):
        t = sub(t, '<h2>Super Admin</h2>', BRAND_SUPER, name=name)
    elif name in ('dashboard-pluser.html', 'dashboard-ukuser.html'):
        if name == 'dashboard-pluser.html':
            t = sub(t, '🔧 Manage Local Stock', 'Manage Local Stock', name=name)
            t = sub(t, '📜 Order History', 'Order History', name=name)
        t = sub(t, '''    <div>
      <h3>🛒 Order Summary</h3>''', '''    <div class="section order-summary">
      <h3>Order Summary</h3>''', name=name)
        t = sub(t, '✅ Confirm and Submit Order', 'Confirm and Submit Order', name=name)
        t = wrap_table(t, 'stockTable', name)
    elif name == 'dashboard-monika.html':
        t = sub(t, '<button class="actions" style="background:#00a8e8;color:#fff;margin-right:1em;" onclick="location.href=\'order-monika.html\'">📜 Order History</button>',
                '<button onclick="location.href=\'order-monika.html\'">Order History</button>', name=name)
        t = sub(t, '<button class="actions" style="background:#00a8e8;color:#fff;" onclick="location.href=\'dashboard-monika.html\'">🔄 Refresh</button>',
                '<button onclick="location.href=\'dashboard-monika.html\'">Refresh</button>', name=name)
        t = sub(t, '<div style="margin-top:2em;">', '<div class="controls">', name=name)
        t = wrap_table(t, 'localStockTable', name)
    elif name == 'manage-pl-stock.html':
        t = wrap_table(t, 'localStockTable', name)
    elif name == 'dashboard-uk-stock.html':
        t = wrap_table(t, 'combinedTable', name)
    return t


for shell, names in SHELL.items():
    for name in names:
        p = repo / name
        src = p.read_text(encoding='utf-8')
        out = page_edits(name, restyle_head(src, shell, name))
        p.write_text(out, encoding='utf-8')
        print(f'{name:28s} {shell:5s} {len(src):6d} -> {len(out):6d}')
