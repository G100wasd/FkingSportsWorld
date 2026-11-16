# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_all

datas = [('..\\..\\frontend', 'frontend'),
         ('..\\serverConfig.json', '.'), ('..\\defaultsConfig.json', '.'),
         ('..\\sessionConfig.json', '.'), ('..\\accountsConfig.json', '.'),
         ('..\\logo.ico', '.')]   # 托盘图标
binaries = []
hiddenimports = ['pystray._win32']   # pystray 按平台动态导入后端
tmp_ret = collect_all('webview')
datas += tmp_ret[0]; binaries += tmp_ret[1]; hiddenimports += tmp_ret[2]


a = Analysis(
    ['main.py'],
    pathex=[],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['torch', 'torchvision', 'matplotlib', 'lxml', 'win32', 'win32com', 'pythonwin', 'pywin32_system32',
              # 完全用不到的包：tkinter(pywebview 不需要)、jupyter 生态误收链
              'tkinter', '_tkinter', 'IPython', 'jedi', 'parso',
              'pyzmq', 'zmq', 'ipykernel', 'jupyter_client', 'jupyter_console',
              'jupyter_server', 'ipywidgets', 'tornado', 'notebook',
              # scipy 中拟合链路（CubicSpline/SLSQP）从不加载的子包
              'scipy.stats', 'scipy.integrate', 'scipy.ndimage'],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)
splash = Splash(
    '..\\splash.png',
    binaries=a.binaries,
    datas=a.datas,
    text_pos=None,
    text_size=12,
    minify_script=True,
    always_on_top=True,
)

exe = EXE(
    pyz,
    a.scripts,
    splash,
    [],
    exclude_binaries=True,
    name='wasdSports',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=['..\\logo.ico'],
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    splash.binaries,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='wasdSports',
)
