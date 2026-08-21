"""
真实游戏界面渲染脚本
严格按照 client4.0/ui.js 的 PALETTE 与绘制函数实现，复刻游戏真实截图
用于生成 720x1280 竖版、1920x1080 横版推广图

游戏设计规范（来自 client4.0/utils/ui.js）：
- 底色: #F5F0E8 / #EAE2D5
- 主色: #8B6914（金棕) #D4A843（亮金)
- 文字: #3C2F28（深棕) #9B8B7A（次要)
- 卡片: 白底#FFFFFF + 描边#E8E3DA, 圆角12~20
- 阶段色: 蓝#4A90D9 / 红#D94A4A / 绿#4AB86A
- 棋盘点: #C9BBA4
- 棋子: 黑#1A1A1A, 白#FEFEFE
"""
from PIL import Image, ImageDraw, ImageFont
import math
import os

# ============ 游戏配色（与 ui.js 完全一致）============
PAL = {
    'bg': '#F5F0E8',
    'bg_top': '#F5F0E8',
    'bg_bottom': '#EAE2D5',
    'panel': '#FFFFFF',
    'panel_border': '#E8E3DA',
    'gold': '#8B6914',
    'gold_bright': '#D4A843',
    'text': '#3C2F28',
    'text_dim': '#9B8B7A',
    'text_on_gold': '#FFF8E8',
    'blue': '#4A90D9',
    'red': '#D94A4A',
    'green': '#4AB86A',
    'board_dot': '#C9BBA4',
    'black_piece': '#1A1A1A',
    'white_piece': '#FEFEFE',
    'white_piece_stroke': '#D0D0D0',
}

# ============ 字体 ============
FONT_PATHS = [
    '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc',
    '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc',
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
]

FONT_FAMILY = None
for fp in FONT_PATHS:
    if os.path.exists(fp):
        FONT_FAMILY = fp
        break
if not FONT_FAMILY:
    FONT_FAMILY = '/usr/share/fonts/dejavu/DejaVuSans.ttf'

def font(size):
    try:
        return ImageFont.truetype(FONT_FAMILY, size)
    except:
        return ImageFont.load_default()


# ============ 绘制辅助（与 ui.js 一致）============
def fill_bg(img, W, H):
    """米金渐变背景"""
    draw = ImageDraw.Draw(img)
    for y in range(H):
        t = y / max(H - 1, 1)
        # 线性插值 #F5F0E8 -> #EAE2D5
        r1, g1, b1 = 0xF5, 0xF0, 0xE8
        r2, g2, b2 = 0xEA, 0xE2, 0xD5
        r = int(r1 + (r2 - r1) * t)
        g = int(g1 + (g2 - g1) * t)
        b = int(b1 + (b2 - b1) * t)
        draw.line([(0, y), (W, y)], fill=(r, g, b))


def round_rect(draw, xy, radius, fill=None, outline=None, width=1):
    """圆角矩形"""
    x1, y1, x2, y2 = xy
    draw.rounded_rectangle(xy, radius=radius, fill=fill, outline=outline, width=width)


def draw_card(draw, x, y, w, h, radius=14, outline=PAL['panel_border'], fill=PAL['panel'], width=1):
    """白底圆角卡片（drawCard）"""
    round_rect(draw, (x, y, x + w, y + h), radius, fill=fill, outline=outline, width=width)


def draw_text(draw, text, x, y, color=PAL['text'], size=16, bold=False, anchor='la'):
    """绘制文本，anchor='la'=左上, 'mm'=居中"""
    fnt = font(size)
    draw.text((x, y), text, fill=color, font=fnt, anchor=anchor)


def draw_avatar(draw, cx, cy, r, label='', avatar='', ring=False):
    """头像：金棕渐变 + 昵称首字符（模拟 drawAvatar 降级方案）"""
    if ring:
        draw.ellipse([cx - r - 3, cy - r - 3, cx + r + 3, cy + r + 3], fill=PAL['gold_bright'])
    # 圆形裁剪：用浅米色 +描边
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill='#F5EEDC', outline=PAL['panel_border'], width=1)
    # 头像内容：取昵称第一个字符（金棕色）
    ch = (label or '玩')[0]
    try:
        f = font(int(r * 1.0))
        draw.text((cx, cy), ch, fill=PAL['gold'], font=f, anchor='mm')
    except:
        pass


def draw_piece(draw, cx, cy, r, color):
    """棋子"""
    if color == 1:  # 黑
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=PAL['black_piece'], outline='#000', width=1)
    else:  # 白
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=PAL['white_piece'], outline=PAL['white_piece_stroke'], width=1)


def draw_board(draw, x, y, size, board):
    """绘制 6x6 棋盘（含交叉点和棋子）
    size: 棋盘总像素尺寸
    board: 6x6 数组 (0空 1黑 2白)
    """
    # 木纹棋盘底
    draw.rounded_rectangle((x, y, x + size, y + size), radius=8, fill='#E8D4B0', outline=PAL['gold'], width=2)
    # 内框
    pad = int(size * 0.04)
    inner_x, inner_y = x + pad, y + pad
    inner_size = size - pad * 2
    draw.rounded_rectangle((inner_x, inner_y, inner_x + inner_size, inner_y + inner_size), radius=4, fill='#D9C19A', outline=PAL['gold'], width=1)
    # 6x6 交叉点
    cell = inner_size / 6
    pts = []
    for r in range(6):
        for c in range(6):
            px = inner_x + cell * (c + 0.5)
            py = inner_y + cell * (r + 0.5)
            pts.append((px, py))
            # 画棋盘点
            dot_r = max(2, int(size * 0.012))
            draw.ellipse([px - dot_r, py - dot_r, px + dot_r, py + dot_r], fill=PAL['board_dot'])
    # 画棋子
    piece_r = int(cell * 0.38)
    for r in range(6):
        for c in range(6):
            if board[r][c] != 0:
                px, py = pts[r * 6 + c]
                draw_piece(draw, int(px), int(py), piece_r, board[r][c])


def draw_phase_label(draw, cx, cy, text, color):
    """阶段标签（圆角胶囊）"""
    fnt = font(28)
    # 测量文本宽度
    bbox = draw.textbbox((0, 0), text, font=fnt)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    pad_x, pad_y = 28, 14
    w, h = tw + pad_x * 2, th + pad_y * 2
    x1, y1 = cx - w // 2, cy - h // 2
    x2, y2 = cx + w // 2, cy + h // 2
    draw.rounded_rectangle((x1, y1, x2, y2), radius=h // 2, fill=color)
    draw.text((cx, cy), text, fill='white', font=fnt, anchor='mm')


def draw_ring_timer(draw, cx, cy, r, progress, color):
    """倒计时环形进度条 (0~1)"""
    # 背景圆环
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], outline='#E8E3DA', width=4)
    # 进度圆弧
    if progress > 0:
        end_angle = -90 + 360 * progress
        draw.arc([cx - r, cy - r, cx + r, cy + r], start=-90, end=end_angle, fill=color, width=4)


def draw_player_card(draw, x, y, w, h, name, avatar, rank, rank_score, remain, remain_label='剩余', phase_color=None):
    """玩家信息卡片"""
    draw_card(draw, x, y, w, h, radius=14)
    # 头像
    ax = x + 32
    ay = y + h // 2
    draw_avatar(draw, ax, ay, 22, name, avatar, ring=True)
    # 名字
    draw_text(draw, name, ax + 36, ay - 12, PAL['text'], size=18, bold=True)
    # 段位 + 积分
    draw_text(draw, f"{rank} · {rank_score}", ax + 36, ay + 10, PAL['text_dim'], size=13)
    # 右上：剩余/可揪子
    if remain:
        rx = x + w - 70
        ry = y + h // 2
        if remain_label == '可揪子':
            draw.rounded_rectangle((rx - 20, ry - 14, rx + 60, ry + 14), radius=14, fill=phase_color or PAL['gold'])
            draw_text(draw, f"揪子 {remain}", rx + 20, ry, 'white', size=14, bold=True, anchor='mm')
        else:
            draw_text(draw, f"{remain_label}", rx, ry - 12, PAL['text_dim'], size=12, anchor='mm')
            draw_text(draw, f"{remain}", rx, ry + 8, PAL['text'], size=18, bold=True, anchor='mm')
    # 倒计时环形
    draw_ring_timer(draw, x + w - 22, y + h // 2, 14, 0.75, phase_color or PAL['gold'])


def draw_button(draw, x, y, w, h, text, color, text_color='white'):
    """圆角按钮"""
    draw.rounded_rectangle((x, y, x + w, y + h), radius=h // 2, fill=color)
    fnt = font(20)
    draw.text((x + w // 2, y + h // 2), text, fill=text_color, font=fnt, anchor='mm')


def draw_bottom_nav(draw, W, H, active='home'):
    """底部导航栏（4 个 tab: 首页/对局/排行榜/我的)"""
    nav_h = 56
    nav_y = H - nav_h
    # 背景
    draw.rectangle((0, nav_y, W, H), fill=PAL['panel'], outline=None)
    draw.line((0, nav_y, W, nav_y), fill=PAL['panel_border'], width=1)
    # 4 个 tab
    tabs = [('home', '首页'), ('match', '对局'), ('rank', '排行榜'), ('profile', '我的')]
    tab_w = W // 4
    for i, (key, label) in enumerate(tabs):
        tx = i * tab_w + tab_w // 2
        ty = nav_y + nav_h // 2
        color = PAL['gold'] if key == active else PAL['text_dim']
        # 图标占位：圆点
        draw.ellipse([tx - 6, ty - 22, tx + 6, ty - 10], fill=color)
        draw_text(draw, label, tx, ty + 14, color, size=12, bold=(key == active), anchor='mm')


def draw_status_bar(draw, W, h=24):
    """状态栏（时间/信号/电量)"""
    draw.rectangle((0, 0, W, h), fill=PAL['bg_top'])
    draw_text(draw, '15:23', 12, h // 2, PAL['text'], size=14, anchor='lm')
    draw_text(draw, '📶  🔋', W - 12, h // 2, PAL['text'], size=14, anchor='rm')


def render_home(W, H, out_path):
    """首页大厅场景"""
    img = Image.new('RGB', (W, H), PAL['bg'])
    draw = ImageDraw.Draw(img)
    fill_bg(img, W, H)
    draw_status_bar(draw, W)
    # 标题
    draw_text(draw, '下六儿', W // 2, 70, PAL['text'], size=36, bold=True, anchor='mm')
    draw_text(draw, '六子棋 · 实时双人对战', W // 2, 108, PAL['text_dim'], size=14, anchor='mm')
    # 中央棋盘动画（小)
    board_size = min(W - 80, 320)
    bx = (W - board_size) // 2
    by = 150
    # 简单棋盘（演示)
    board = [[0] * 6 for _ in range(6)]
    # 模拟对局中的部分棋子
    board[1][2] = 1; board[2][1] = 1; board[2][2] = 1; board[1][1] = 2
    board[3][3] = 2; board[3][4] = 1; board[4][3] = 2
    draw_board(draw, bx, by, board_size, board)
    # "对战"按钮
    btn_w = 200; btn_h = 56
    btn_x = (W - btn_w) // 2
    btn_y = by + board_size + 30
    draw_button(draw, btn_x, btn_y, btn_w, btn_h, '快速对战', PAL['gold'])
    # 副按钮：好友房
    draw_button(draw, btn_x, btn_y + 70, btn_w, btn_h, '好友房', PAL['panel'], text_color=PAL['gold'])
    draw.rounded_rectangle((btn_x, btn_y + 70, btn_x + btn_w, btn_y + 70 + btn_h), radius=28, outline=PAL['gold'], width=2)
    draw.text((btn_x + btn_w // 2, btn_y + 70 + btn_h // 2), '好友房', fill=PAL['gold'], font=font(20), anchor='mm')
    # 个人卡（底部，缩略)
    card_x, card_y = 20, btn_y + 160
    card_w = W - 40
    card_h = 80
    draw_card(draw, card_x, card_y, card_w, card_h, radius=14)
    draw_avatar(draw, card_x + 40, card_y + 40, 22, '', 'emoji:👴', ring=True)
    draw_text(draw, '晒谷场的风', card_x + 76, card_y + 22, PAL['text'], size=18, bold=True)
    draw_text(draw, '初级小六 · 3', card_x + 76, card_y + 48, PAL['text_dim'], size=14)
    # 精力条
    bar_x = card_x + 76; bar_y = card_y + 68; bar_w = 180; bar_h = 10
    draw.rounded_rectangle((bar_x, bar_y, bar_x + bar_w, bar_y + bar_h), radius=5, fill='#EAE2D5')
    draw.rounded_rectangle((bar_x, bar_y, bar_x + int(bar_w * 0.83), bar_y + bar_h), radius=5, fill=PAL['gold'])
    draw_text(draw, '精力 25/30', bar_x + bar_w + 12, bar_y - 2, PAL['text_dim'], size=11)
    # 底部导航
    draw_bottom_nav(draw, W, H, 'home')
    img.save(out_path, 'PNG', optimize=True)
    print(f'saved {out_path}')


def render_match_placing(W, H, out_path):
    """对局中 - 下子阶段"""
    img = Image.new('RGB', (W, H), PAL['bg'])
    draw = ImageDraw.Draw(img)
    fill_bg(img, W, H)
    draw_status_bar(draw, W)
    # 顶部对手玩家卡片
    pc_h = 60
    draw_player_card(draw, 16, 50, W - 32, pc_h,
                     '半目胜负', 'emoji:🧩', '初级小六', 0, '17/18', '剩余', PAL['gold'])
    # 阶段标签（中央顶部)
    draw_phase_label(draw, W // 2, 145, '下子阶段', PAL['blue'])
    # 中央棋盘
    board_size = min(W - 60, 420)
    bx = (W - board_size) // 2
    by = 180
    # 模拟对局中：玩家黑子 5 颗，白子 6 颗
    board = [[0] * 6 for _ in range(6)]
    # 黑子（player)
    board[2][2] = 1; board[2][3] = 1; board[3][2] = 1
    board[0][0] = 1; board[0][1] = 1
    # 白子（对手)
    board[1][2] = 2; board[1][3] = 2; board[2][1] = 2
    board[3][3] = 2; board[4][4] = 2; board[5][5] = 2
    # 提示标记：当前可下的位置（淡蓝点)
    draw_board(draw, bx, by, board_size, board)
    # 底部我方玩家卡片
    me_y = by + board_size + 18
    draw_player_card(draw, 16, me_y, W - 32, pc_h,
                     '晒谷场的风', 'emoji:👴', '初级小六', 3, '12/18', '剩余', PAL['gold'])
    # 底部按钮（求和/认输/设置）
    btn_y = me_y + pc_h + 18
    bw = (W - 32 - 16) // 3
    draw_button(draw, 16, btn_y, bw, 48, '求和', PAL['panel'], text_color=PAL['gold'])
    draw.rounded_rectangle((16, btn_y, 16 + bw, btn_y + 48), radius=24, outline=PAL['gold'], width=2)
    draw.text((16 + bw // 2, btn_y + 24), '求和', fill=PAL['gold'], font=font(18), anchor='mm')
    cx = 16 + bw + 8
    draw_button(draw, cx, btn_y, bw, 48, '认输', PAL['red'])
    cx2 = cx + bw + 8
    draw_button(draw, cx2, btn_y, bw, 48, '设置', PAL['panel'], text_color=PAL['gold'])
    draw.rounded_rectangle((cx2, btn_y, cx2 + bw, btn_y + 48), radius=24, outline=PAL['gold'], width=2)
    draw.text((cx2 + bw // 2, btn_y + 24), '设置', fill=PAL['gold'], font=font(18), anchor='mm')
    img.save(out_path, 'PNG', optimize=True)
    print(f'saved {out_path}')


def render_match_capturing(W, H, out_path):
    """对局中 - 揪子阶段（4子成方 + 6子成六 高光）"""
    img = Image.new('RGB', (W, H), PAL['bg'])
    draw = ImageDraw.Draw(img)
    fill_bg(img, W, H)
    draw_status_bar(draw, W)
    # 顶部对手玩家卡片（含揪子数)
    draw_player_card(draw, 16, 50, W - 32, 60,
                     '半目胜负', 'emoji:🧩', '初级小六', 0, '2', '可揪子', PAL['green'])
    # 阶段标签
    draw_phase_label(draw, W // 2, 145, '揪子阶段', PAL['green'])
    # 中央棋盘
    board_size = min(W - 60, 420)
    bx = (W - board_size) // 2
    by = 180
    board = [[0] * 6 for _ in range(6)]
    # 黑子（我方）4 子成方 (2x2) 在左上角
    board[0][0] = 1; board[0][1] = 1; board[1][0] = 1; board[1][1] = 1
    # 黑子其他位置
    board[3][0] = 1; board[4][1] = 1
    # 白子（对手）6 子成六 (横向)
    for c in range(6):
        board[3][c] = 2
    # 其他
    board[5][5] = 1
    board[2][4] = 2
    draw_board(draw, bx, by, board_size, board)
    # 高亮成方（2x2 黑子)金色描边外框
    cell = (board_size - int(board_size * 0.04) * 2) / 6
    pad = int(board_size * 0.04)
    inner_x = bx + pad
    inner_y = by + pad
    # 成方外框 (0,0) 到 (1,1)
    hx1 = inner_x + cell * 0 - 4
    hy1 = inner_y + cell * 0 - 4
    hx2 = inner_x + cell * 2 + 4
    hy2 = inner_y + cell * 2 + 4
    draw.rounded_rectangle((hx1, hy1, hx2, hy2), radius=10, outline=PAL['gold_bright'], width=4)
    # 成六外框 (3,0) 到 (3,5)
    hx1 = inner_x + cell * 0 - 4
    hy1 = inner_y + cell * 3 - 4
    hx2 = inner_x + cell * 6 + 4
    hy2 = inner_y + cell * 4 + 4
    draw.rounded_rectangle((hx1, hy1, hx2, hy2), radius=10, outline=PAL['gold_bright'], width=4)
    # 系统提示气泡
    tip_x = bx + board_size // 2
    tip_y = by + board_size + 30
    tip_text = '成方 / 成六！可揪对方 1 子'
    fnt = font(16)
    bbox = draw.textbbox((0, 0), tip_text, font=fnt)
    tw = bbox[2] - bbox[0]
    draw.rounded_rectangle((tip_x - tw // 2 - 18, tip_y - 18, tip_x + tw // 2 + 18, tip_y + 18), radius=18, fill=PAL['gold_bright'])
    draw.text((tip_x, tip_y), tip_text, fill='white', font=fnt, anchor='mm')
    # 底部我方玩家卡片
    me_y = tip_y + 60
    draw_player_card(draw, 16, me_y, W - 32, 60,
                     '晒谷场的风', 'emoji:👴', '初级小六', 3, '1', '可揪子', PAL['green'])
    img.save(out_path, 'PNG', optimize=True)
    print(f'saved {out_path}')


def render_match_settle(W, H, out_path):
    """对局中 - 胜利结算"""
    img = Image.new('RGB', (W, H), PAL['bg'])
    draw = ImageDraw.Draw(img)
    fill_bg(img, W, H)
    draw_status_bar(draw, W)
    # 棋盘（背景残局)
    board_size = min(W - 60, 420)
    bx = (W - board_size) // 2
    by = 180
    board = [[0] * 6 for _ in range(6)]
    board[0][0] = 1; board[0][1] = 1; board[1][0] = 1; board[1][1] = 1
    for c in range(5):
        board[3][c] = 2
    board[5][5] = 1
    board[2][4] = 2; board[2][3] = 1
    draw_board(draw, bx, by, board_size, board)
    # 结算弹窗（中央)
    cw = W - 60
    ch = 380
    cx = (W - cw) // 2
    cy = by + (board_size - ch) // 2
    # 弹窗阴影
    shadow = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sd.rounded_rectangle((cx + 4, cy + 4, cx + cw + 4, cy + ch + 4), radius=20, fill=(0, 0, 0, 40))
    img.paste(shadow, (0, 0), shadow)
    # 弹窗主体
    overlay = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    od.rounded_rectangle((cx, cy, cx + cw, cy + ch), radius=20, fill=(255, 255, 255, 255), outline=PAL['panel_border'], width=1)
    img.paste(overlay, (0, 0), overlay)
    draw = ImageDraw.Draw(img)
    # 奖杯图标
    draw.text((W // 2, cy + 50), '🏆', fill=PAL['gold_bright'], font=font(64), anchor='mm')
    # "胜利"字样
    draw.text((W // 2, cy + 120), '胜  利', fill=PAL['gold'], font=font(40, ), anchor='mm')
    # 积分 +3
    draw.text((W // 2, cy + 170), '+ 3', fill=PAL['red'], font=font(32), anchor='mm')
    # 段位升级
    draw.text((W // 2, cy + 210), '初级小六 → 中级小六', fill=PAL['text_dim'], font=font(16), anchor='mm')
    # 按钮
    bw = (cw - 60) // 2
    btn_y = cy + ch - 80
    draw_button(draw, cx + 30, btn_y, bw, 50, '再来一局', PAL['gold'])
    draw_button(draw, cx + cw - 30 - bw, btn_y, bw, 50, '返回大厅', PAL['panel'], text_color=PAL['gold'])
    draw.rounded_rectangle((cx + cw - 30 - bw, btn_y, cx + cw - 30, btn_y + 50), radius=25, outline=PAL['gold'], width=2)
    draw.text((cx + cw - 30 - bw + bw // 2, btn_y + 25), '返回大厅', fill=PAL['gold'], font=font(18), anchor='mm')
    img.save(out_path, 'PNG', optimize=True)
    print(f'saved {out_path}')


def render_rank(W, H, out_path):
    """排行榜场景"""
    img = Image.new('RGB', (W, H), PAL['bg'])
    draw = ImageDraw.Draw(img)
    fill_bg(img, W, H)
    draw_status_bar(draw, W)
    # 标题
    draw_text(draw, '排行榜', W // 2, 60, PAL['text'], size=28, bold=True, anchor='mm')
    # tab 切换
    tab_y = 110
    tab_w = 96; tab_h = 38
    # 积分榜（激活)
    draw.rounded_rectangle((W // 2 - tab_w - 7, tab_y, W // 2 - 7, tab_y + tab_h), radius=tab_h // 2, fill=PAL['gold'])
    draw.text((W // 2 - tab_w // 2 - 7, tab_y + tab_h // 2), '积分榜', fill='white', font=font(18), anchor='mm')
    # 胜率榜
    draw.rounded_rectangle((W // 2 + 7, tab_y, W // 2 + 7 + tab_w, tab_y + tab_h), radius=tab_h // 2, fill=PAL['panel'], outline=PAL['panel_border'], width=1)
    draw.text((W // 2 + 7 + tab_w // 2, tab_y + tab_h // 2), '胜率榜', fill=PAL['text_dim'], font=font(18), anchor='mm')
    # 列表
    list_y = tab_y + tab_h + 14
    row_h = 48
    rows = [
        ('1', '小六同学', 'emoji:🤖', '高级老六', 1250),
        ('2', '棋逢对手', 'emoji:🎲', '中级老六', 1100),
        ('3', '六耳猕猴', 'emoji:👾', '中级小六', 850),
        ('4', '晒谷场的风', 'emoji:👴', '初级小六', 600),
        ('5', '溪边放牛71', 'emoji:👴', '初级小六', 420),
    ]
    for i, (rank, name, av, rk, sc) in enumerate(rows):
        y = list_y + i * (row_h + 8)
        draw_card(draw, 16, y, W - 32, row_h, radius=10)
        color = PAL['gold'] if i < 3 else PAL['text_dim']
        draw.text((48, y + row_h // 2), rank, fill=color, font=font(16, ), anchor='rm')
        draw_avatar(draw, 78, y + row_h // 2, 14, name, av)
        draw_text(draw, name, 100, y + row_h // 2 - 8, PAL['text'], size=14, bold=True)
        draw_text(draw, rk, 100, y + row_h // 2 + 10, PAL['text_dim'], size=11)
        draw_text(draw, f'积分 {sc}', W - 28, y + row_h // 2, PAL['gold'], size=14, bold=True, anchor='rm')
    # 我的卡
    me_y = H - 56 - 80
    draw_card(draw, 16, me_y, W - 32, 64, radius=10, outline=PAL['gold'], width=2)
    draw.text((48, me_y + 32), '4', fill=PAL['gold'], font=font(16), anchor='rm')
    draw_avatar(draw, 78, me_y + 32, 18, '晒谷场的风', 'emoji:👴', ring=True)
    draw_text(draw, '晒谷场的风', 100, me_y + 22, PAL['text'], size=16, bold=True)
    draw_text(draw, '初级小六', 100, me_y + 44, PAL['text_dim'], size=12)
    draw_text(draw, '积分 3', W - 28, me_y + 32, PAL['gold'], size=16, bold=True, anchor='rm')
    # 底部导航
    draw_bottom_nav(draw, W, H, 'rank')
    img.save(out_path, 'PNG', optimize=True)
    print(f'saved {out_path}')


def render_profile(W, H, out_path):
    """个人中心场景"""
    img = Image.new('RGB', (W, H), PAL['bg'])
    draw = ImageDraw.Draw(img)
    fill_bg(img, W, H)
    draw_status_bar(draw, W)
    # 头部渐变区（深棕)
    head_h = 220
    for y in range(head_h):
        t = y / max(head_h - 1, 1)
        r = int(0x3C + (0x2A - 0x3C) * t)
        g = int(0x2F + (0x20 - 0x2F) * t)
        b = int(0x28 + (0x18 - 0x28) * t)
        draw.line([(0, y), (W, y)], fill=(r, g, b))
    # 头像
    draw_avatar(draw, W // 2, 80, 32, '晒谷场的风', 'emoji:👴', ring=True)
    # 昵称
    draw_text(draw, '晒谷场的风', W // 2, 138, 'white', size=20, bold=True, anchor='mm')
    # 段位
    draw_text(draw, '⭐ 初级小六 · 3', W // 2, 165, PAL['gold_bright'], size=14, anchor='mm')
    # 精力卡
    ec_y = head_h + 16
    draw_card(draw, 16, ec_y, W - 32, 100, radius=14)
    draw_text(draw, '精力', 32, ec_y + 18, PAL['text'], size=15, bold=True)
    draw_text(draw, '25/30', W - 32, ec_y + 18, PAL['gold'], size=18, bold=True, anchor='rm')
    # 精力条
    bar_x = 32; bar_y = ec_y + 56; bar_w = W - 64; bar_h = 12
    draw.rounded_rectangle((bar_x, bar_y, bar_x + bar_w, bar_y + bar_h), radius=6, fill='#EAE2D5')
    draw.rounded_rectangle((bar_x, bar_y, bar_x + int(bar_w * 0.83), bar_y + bar_h), radius=6, fill=PAL['gold'])
    # 按钮
    btn_w = (W - 48) // 2
    draw_button(draw, 16, ec_y + 78, btn_w, 14, '看视频 +10', PAL['gold'])
    draw_button(draw, 32 + btn_w, ec_y + 78, btn_w, 14, '分享 +5', PAL['gold'])
    # 签到卡
    sc_y = ec_y + 120
    draw_card(draw, 16, sc_y, W - 32, 100, radius=14)
    draw_text(draw, '每日签到', 32, sc_y + 18, PAL['text'], size=15, bold=True)
    draw.text((32 + 200, sc_y + 18), '+5', fill=PAL['gold'], font=font(16, ), anchor='lm')
    # 签到格子
    cell_w = (W - 64) // 7
    for i in range(7):
        cxx = 32 + i * cell_w
        cyy = sc_y + 50
        bg = PAL['gold'] if i == 3 else '#EAE2D5'
        draw.rounded_rectangle((cxx, cyy, cxx + cell_w - 6, cyy + 32), radius=8, fill=bg)
        label = ['一','二','三','四','五','六','日'][i]
        draw.text((cxx + (cell_w - 6) // 2, cyy + 16), label, fill='white' if i == 3 else PAL['text'], font=font(14), anchor='mm')
    # 底部导航
    draw_bottom_nav(draw, W, H, 'profile')
    img.save(out_path, 'PNG', optimize=True)
    print(f'saved {out_path}')


def render_horizontal(W, H, out_path):
    """横版推广：组合多个场景（游戏全景）"""
    img = Image.new('RGB', (W, H), PAL['bg'])
    draw = ImageDraw.Draw(img)
    fill_bg(img, W, H)
    # 左侧：标题 + 棋盘
    draw_text(draw, '下 六 儿', 80, 60, PAL['text'], size=42, bold=True, anchor='lm')
    draw_text(draw, '六子棋 · 实时双人对战', 80, 110, PAL['text_dim'], size=16, anchor='lm')
    # 中央棋盘
    board_size = H - 160
    bx = 80
    by = 150
    board = [[0] * 6 for _ in range(6)]
    board[0][0] = 1; board[0][1] = 1; board[1][0] = 1; board[1][1] = 1
    for c in range(6):
        board[3][c] = 2
    board[2][2] = 1; board[2][3] = 1; board[4][4] = 1; board[5][5] = 1
    draw_board(draw, bx, by, board_size, board)
    # 右侧：游戏手机界面预览（简化）
    px = bx + board_size + 50
    py = 150
    pw = W - px - 80
    ph = H - py - 80
    # 手机外框
    draw.rounded_rectangle((px, py, px + pw, py + ph), radius=30, fill=PAL['panel'], outline=PAL['gold'], width=4)
    # 状态栏
    draw.text((px + 12, py + 16), '15:23', fill=PAL['text'], font=font(12))
    # 标题
    draw.text((px + pw // 2, py + 50), '下子阶段', fill=PAL['blue'], font=font(20, ), anchor='mm')
    # 顶部玩家卡（缩略)
    draw_player_card(draw, px + 12, py + 80, pw - 24, 36,
                     '半目胜负', 'emoji:🧩', '初级小六', 0, '', None)
    # 小棋盘
    sb_size = min(pw - 40, 220)
    sby = py + 140
    sbb = [[0] * 6 for _ in range(6)]
    sbb[0][0] = 1; sbb[0][1] = 1; sbb[1][0] = 1; sbb[1][1] = 1
    sbb[3][2] = 2; sbb[3][3] = 2; sbb[3][4] = 2; sbb[3][5] = 2
    sbb[2][3] = 1; sbb[4][2] = 2
    draw_board(draw, px + (pw - sb_size) // 2, sby, sb_size, sbb)
    # 底部我方卡
    draw_player_card(draw, px + 12, sby + sb_size + 16, pw - 24, 36,
                     '晒谷场的风', 'emoji:👴', '初级小六', 3, '', None)
    img.save(out_path, 'PNG', optimize=True)
    print(f'saved {out_path}')


def render_horizontal_capture(W, H, out_path):
    """横版推广：揪子成方/成六高光"""
    img = Image.new('RGB', (W, H), PAL['bg'])
    draw = ImageDraw.Draw(img)
    fill_bg(img, W, H)
    # 左侧：标题 + 棋盘（高光版)
    draw_text(draw, '成方 / 成六', 80, 60, PAL['gold'], size=42, bold=True, anchor='lm')
    draw_text(draw, '4 子连方 / 6 子一线，可揪对方 1 子', 80, 110, PAL['text_dim'], size=16, anchor='lm')
    # 中央棋盘
    board_size = H - 160
    bx = 80
    by = 150
    board = [[0] * 6 for _ in range(6)]
    board[0][0] = 1; board[0][1] = 1; board[1][0] = 1; board[1][1] = 1
    for c in range(6):
        board[3][c] = 2
    board[4][2] = 1; board[5][5] = 1; board[2][4] = 2
    draw_board(draw, bx, by, board_size, board)
    # 高亮成方/成六
    cell = (board_size - int(board_size * 0.04) * 2) / 6
    pad = int(board_size * 0.04)
    inner_x = bx + pad
    inner_y = by + pad
    # 成方 (0,0) 到 (1,1)
    draw.rounded_rectangle((inner_x - 6, inner_y - 6, inner_x + cell * 2 + 6, inner_y + cell * 2 + 6), radius=12, outline=PAL['gold_bright'], width=6)
    # 成六 (3,0) 到 (3,5)
    draw.rounded_rectangle((inner_x - 6, inner_y + cell * 3 - 6, inner_x + cell * 6 + 6, inner_y + cell * 4 + 6), radius=12, outline=PAL['gold_bright'], width=6)
    # 右侧：游戏手机界面预览（揪子阶段）
    px = bx + board_size + 50
    py = 150
    pw = W - px - 80
    ph = H - py - 80
    draw.rounded_rectangle((px, py, px + pw, py + ph), radius=30, fill=PAL['panel'], outline=PAL['gold'], width=4)
    draw.text((px + 12, py + 16), '15:23', fill=PAL['text'], font=font(12))
    draw.text((px + pw // 2, py + 50), '揪子阶段', fill=PAL['green'], font=font(20, ), anchor='mm')
    draw_player_card(draw, px + 12, py + 80, pw - 24, 36, '半目胜负', 'emoji:🧩', '初级小六', 0, '揪子 2', '可揪子', PAL['green'])
    sb_size = min(pw - 40, 220)
    sby = py + 140
    sbb = [[0] * 6 for _ in range(6)]
    sbb[0][0] = 1; sbb[0][1] = 1; sbb[1][0] = 1; sbb[1][1] = 1
    for c in range(6):
        sbb[3][c] = 2
    draw_board(draw, px + (pw - sb_size) // 2, sby, sb_size, sbb)
    # 高亮
    pad2 = int(sb_size * 0.04)
    cell2 = (sb_size - pad2 * 2) / 6
    inner_x2 = px + (pw - sb_size) // 2 + pad2
    inner_y2 = sby + pad2
    draw.rounded_rectangle((inner_x2 - 4, inner_y2 - 4, inner_x2 + cell2 * 2 + 4, inner_y2 + cell2 * 2 + 4), radius=8, outline=PAL['gold_bright'], width=4)
    draw.rounded_rectangle((inner_x2 - 4, inner_y2 + cell2 * 3 - 4, inner_x2 + cell2 * 6 + 4, inner_y2 + cell2 * 4 + 4), radius=8, outline=PAL['gold_bright'], width=4)
    draw_player_card(draw, px + 12, sby + sb_size + 16, pw - 24, 36, '晒谷场的风', 'emoji:👴', '初级小六', 3, '揪子 1', '可揪子', PAL['green'])
    img.save(out_path, 'PNG', optimize=True)
    print(f'saved {out_path}')


def render_horizontal_settle(W, H, out_path):
    """横版推广：胜利结算"""
    img = Image.new('RGB', (W, H), PAL['bg'])
    draw = ImageDraw.Draw(img)
    fill_bg(img, W, H)
    # 左侧：标题
    draw_text(draw, '胜  利', 80, 80, PAL['gold'], size=56, bold=True, anchor='lm')
    draw_text(draw, '+3 积分 · 段位升级', 80, 160, PAL['red'], size=24, anchor='lm')
    draw_text(draw, '初级小六 → 中级小六', 80, 200, PAL['text_dim'], size=18, anchor='lm')
    # 左侧：奖杯图标
    draw.text((200, 320), '🏆', fill=PAL['gold_bright'], font=font(96), anchor='mm')
    # 左侧：CTA
    draw_button(draw, 80, 480, 240, 60, '再来一局', PAL['gold'])
    draw_button(draw, 80, 560, 240, 60, '查看排行榜', PAL['panel'], text_color=PAL['gold'])
    draw.rounded_rectangle((80, 560, 320, 620), radius=30, outline=PAL['gold'], width=2)
    draw.text((200, 590), '查看排行榜', fill=PAL['gold'], font=font(20), anchor='mm')
    # 右侧：结算弹窗卡片（含棋盘残局）
    px = 380
    py = 100
    pw = W - px - 80
    ph = H - py - 80
    draw.rounded_rectangle((px, py, px + pw, py + ph), radius=20, fill=PAL['panel'], outline=PAL['gold'], width=2)
    # 棋盘残局
    board_size = min(pw - 80, ph - 160)
    board_size = min(board_size, 480)
    bx = px + (pw - board_size) // 2
    by = py + 60
    board = [[0] * 6 for _ in range(6)]
    board[0][0] = 1; board[0][1] = 1; board[1][0] = 1; board[1][1] = 1
    for c in range(5):
        board[3][c] = 2
    board[5][5] = 1; board[2][4] = 2
    draw_board(draw, bx, by, board_size, board)
    # 结算信息
    info_y = by + board_size + 30
    draw.text((px + pw // 2, info_y), '剩余棋子: 我 14 / 对手 8', fill=PAL['text'], font=font(18), anchor='mm')
    draw.text((px + pw // 2, info_y + 30), '用时: 8分23秒', fill=PAL['text_dim'], font=font(14), anchor='mm')
    img.save(out_path, 'PNG', optimize=True)
    print(f'saved {out_path}')


if __name__ == '__main__':
    OUT = '/tmp/promo'
    os.makedirs(OUT, exist_ok=True)
    # 竖版 720x1280 (微信规范)
    render_home(720, 1280, f'{OUT}/home_720x1280.png')
    render_match_placing(720, 1280, f'{OUT}/match_placing_720x1280.png')
    render_match_capturing(720, 1280, f'{OUT}/match_capturing_720x1280.png')
    render_match_settle(720, 1280, f'{OUT}/match_settle_720x1280.png')
    render_rank(720, 1280, f'{OUT}/rank_720x1280.png')
    render_profile(720, 1280, f'{OUT}/profile_720x1280.png')
    # 横版 1920x1080 (改版)
    render_horizontal(1920, 1080, f'{OUT}/horizontal_1920x1080.png')
    render_horizontal_capture(1920, 1080, f'{OUT}/horizontal_capture_1920x1080.png')
    render_horizontal_settle(1920, 1080, f'{OUT}/horizontal_settle_1920x1080.png')
    print('all done')