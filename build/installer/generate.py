#!/usr/bin/env python3
"""
Renders every bitmap the custom NSIS installer/uninstaller consumes
(`build/installer.nsh`) and the previews shown in `docs/screens/`.

    python3 build/installer/generate.py            # assets only
    python3 build/installer/generate.py --preview  # assets + docs/screens/*.png

Everything is drawn with the same tokens as the renderer:
bg #0B0D0C → #141716, emerald #2FE28C / #10B981 / #04855D,
rose #F47280 / #BE185D, text #E7F2EC, muted #8D9C94, Inter.

NSIS' `SS_BITMAP` static has no alpha channel, therefore every bitmap is 24-bit
BMP drawn on top of the installer page colour.
"""

from __future__ import annotations

import argparse
import os

from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
FONTS = os.path.join(HERE, 'fonts')

# MUI2 sizes: the welcome/finish sidebar is 164×314, the page header 150×57.
SIDEBAR = (164, 314)
HEADER = (150, 57)

EMERALD = (47, 226, 140)
EMERALD_DEEP = (16, 185, 129)
EMERALD_DARK = (4, 133, 93)
INK = (11, 13, 12)
INK_800 = (20, 23, 22)
TEXT = (231, 242, 236)
MUTED = (141, 156, 148)
ROSE = (244, 114, 128)
ROSE_DEEP = (190, 24, 93)


def font(name: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(os.path.join(FONTS, f'Inter-{name}.ttf'), size)


def vertical_gradient(size, top, bottom) -> Image.Image:
    width, height = size
    base = Image.new('RGB', (1, height))
    for y in range(height):
        t = y / max(1, height - 1)
        base.putpixel((0, y), tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3)))
    return base.resize(size)


def grid_lines(image: Image.Image, step: int, alpha: int, color=(255, 255, 255)) -> Image.Image:
    overlay = Image.new('RGBA', image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    for x in range(0, image.width, step):
        draw.line((x, 0, x, image.height), fill=color + (alpha,))
    for y in range(0, image.height, step):
        draw.line((0, y, image.width, y), fill=color + (alpha,))
    return Image.alpha_composite(image.convert('RGBA'), overlay).convert('RGB')


def bloom(image: Image.Image, color, blobs, blur: int) -> Image.Image:
    """Soft radial light blobs, blended additively into the dark base."""
    glow = Image.new('L', image.size, 0)
    gd = ImageDraw.Draw(glow)
    for box, value in blobs:
        gd.ellipse(box, fill=value)
    glow = glow.filter(ImageFilter.GaussianBlur(blur))
    tint = Image.composite(Image.new('RGB', image.size, color), Image.new('RGB', image.size, (0, 0, 0)), glow)
    base = image.convert('RGB')
    return Image.blend(base, Image.blend(base, tint, 0.6), 0.45)


def logo(size: int, tone=EMERALD, tone_dark=EMERALD_DARK, glyph='V', radius_ratio=0.29) -> Image.Image:
    art = vertical_gradient((size, size), tone, tone_dark)
    mask = Image.new('L', (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size - 1, size - 1), radius=int(size * radius_ratio), fill=255)
    layer = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    layer.paste(art, (0, 0), mask)
    draw = ImageDraw.Draw(layer)
    draw.text((size / 2, size / 2 + size * 0.03), glyph, font=font('ExtraBold', int(size * 0.56)),
              fill=(4, 26, 18, 255), anchor='mm')
    return layer


def vertical_rail(accent) -> Image.Image:
    """The emerald hairline that runs down the left edge of the installer page."""
    return accent


def sidebar(accent='emerald') -> Image.Image:
    width, height = SIDEBAR
    tint = EMERALD if accent == 'emerald' else ROSE
    image = vertical_gradient(SIDEBAR, INK, (17, 21, 19))
    image = bloom(image, tint, [
        ((-100, -110, 150, 140), 78),
        ((-120, 190, 190, 500), 26),
    ], 44)
    image = grid_lines(image, 21, 6)

    draw = ImageDraw.Draw(image)
    # accent rail on the right edge (sits against the page body)
    for y in range(height):
        t = 1 - y / (height - 1)
        color = tuple(int(tint[i] * (0.15 + 0.7 * t)) for i in range(3))
        draw.line((width - 1, y, width - 2, y), fill=color)

    mark = logo(58, tint, ROSE_DEEP if accent != 'emerald' else EMERALD_DARK)
    shadow = Image.new('RGBA', image.size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle((26, 32, 26 + 58, 32 + 62), radius=17, fill=(0, 0, 0, 120))
    image = Image.alpha_composite(image.convert('RGBA'), shadow.filter(ImageFilter.GaussianBlur(10))).convert('RGB')
    image.paste(mark, (26, 28), mark)
    draw = ImageDraw.Draw(image)

    draw.text((26, 102), 'VERDANT', font=font('ExtraBold', 17), fill=TEXT)
    draw.text((26, 122), 'LAUNCHER', font=font('ExtraBold', 17), fill=tint)
    draw.text((26, 150), 'Minecraft', font=font('Regular', 10), fill=MUTED)

    # feature ticks
    features = ['Сборки и моды', 'Своя папка', 'Быстрый запуск'] if accent == 'emerald' else \
               ['Удаление ярлыков', 'Очистка реестра', 'Миры сохранены']
    y = 186
    for line in features:
        draw.ellipse((27, y + 3, 32, y + 8), fill=tint)
        draw.text((40, y), line, font=font('Medium', 9), fill=(196, 209, 201))
        y += 20

    draw.text((26, height - 26), 'app.verdant.launcher', font=font('Regular', 8), fill=(96, 110, 102))
    return image


def header(accent='emerald', title='Verdant Launcher') -> Image.Image:
    width, height = HEADER
    tint = EMERALD if accent == 'emerald' else ROSE
    image = vertical_gradient(HEADER, (16, 20, 18), INK)
    image = bloom(image, tint, [((-60, -70, 120, 80), 60)], 30)
    image = grid_lines(image, 16, 5)
    draw = ImageDraw.Draw(image)
    draw.line((0, height - 1, width, height - 1), fill=tuple(int(c * 0.55) for c in tint))
    mark = logo(30, tint, ROSE_DEEP if accent != 'emerald' else EMERALD_DARK, radius_ratio=0.3)
    image.paste(mark, (10, 13), mark)
    draw.text((48, 20), title.upper(), font=font('ExtraBold', 8), fill=TEXT)
    draw.text((48, 32), 'Minecraft launcher', font=font('Regular', 7), fill=MUTED)
    return image


def page_background(accent='emerald') -> Image.Image:
    """The installer page body behind MUI's controls (500×300 preview canvas)."""
    tint = EMERALD if accent == 'emerald' else ROSE
    image = vertical_gradient((500, 300), INK, (18, 22, 20))
    image = bloom(image, tint, [((-160, -200, 320, 160), 46), ((-80, 200, 260, 460), 18)], 48)
    return grid_lines(image, 26, 5)


COLORS = {
    'emerald': (EMERALD, 'emerald'),
    'rose': (ROSE, 'rose'),
}


def save(image: Image.Image, name: str) -> str:
    path = os.path.join(HERE, name)
    image.convert('RGB').save(path, 'BMP')
    print(f'{name}: {image.width}x{image.height} ({os.path.getsize(path) // 1024} KB)')
    return path


def build() -> None:
    save(logo(56).convert('RGB'), 'logo.bmp')
    save(sidebar('emerald'), 'installerSidebar.bmp')
    save(sidebar('rose'), 'uninstallerSidebar.bmp')
    save(header('emerald'), 'installerHeader.bmp')
    save(header('rose', 'Verdant Uninstall'), 'uninstallerHeader.bmp')


# ------------------------------------------------------------------ previews

PAGE = (337, 314)          # MUI page body: 501 px window minus the 164 px sidebar
CHROME_TOP = 26
CHROME_BOTTOM = 34


def _button(draw, page, label, box, kind='ghost') -> None:
    x, y, w, h = box
    if kind == 'primary':
        top, bottom = (92, 243, 175), EMERALD_DARK
        text_color = (4, 30, 20)
    elif kind == 'danger':
        top, bottom = (250, 142, 155), ROSE_DEEP
        text_color = (255, 236, 240)
    else:
        top, bottom = (38, 44, 40), (28, 33, 30)
        text_color = TEXT
    art = vertical_gradient((w, h), top, bottom)
    mask = Image.new('L', (w, h), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, w - 1, h - 1), radius=3, fill=255)
    page.paste(art, (x, y), mask)
    if kind == 'ghost':
        overlay = Image.new('RGBA', (w, h), (0, 0, 0, 0))
        ImageDraw.Draw(overlay).rounded_rectangle((0, 0, w - 1, h - 1), radius=3,
                                                    outline=(255, 255, 255, 52), width=1)
        region = page.crop((x, y, x + w, y + h)).convert('RGBA')
        page.paste(Image.alpha_composite(region, overlay).convert('RGB'), (x, y))
    draw.text((x + w / 2, y + h / 2), label, font=font('SemiBold', 9), fill=text_color, anchor='mm')


def _window(page: Image.Image, accent: str, buttons) -> Image.Image:
    """Adds the wizard chrome (title bar, sidebar, button row) around a MUI page."""
    width, height = page.size
    total = (SIDEBAR[0] + width, CHROME_TOP + height + CHROME_BOTTOM)
    window = Image.new('RGB', total, (10, 12, 11))
    draw = ImageDraw.Draw(window)
    draw.rectangle((0, 0, total[0], CHROME_TOP), fill=(16, 19, 17))
    draw.text((10, CHROME_TOP / 2), 'Verdant Launcher Setup', font=font('Medium', 8), fill=(178, 192, 184), anchor='lm')
    for i, glyph in enumerate(('–', '□', '✕')):
        draw.text((total[0] - 16 - i * 20, CHROME_TOP / 2), glyph, font=font('Regular', 9), fill=(150, 162, 155), anchor='mm')

    window.paste(page, (SIDEBAR[0], CHROME_TOP))
    window.paste(sidebar(accent), (0, CHROME_TOP))
    draw = ImageDraw.Draw(window)
    if buttons:
        x = total[0] - 12
        for label, kind in reversed(buttons):
            x -= 84
            _button(draw, window, label, (x, CHROME_TOP + height + 6, 84, 22), kind)
            x -= 8
    return window


def _page(accent, title, subtitle, draw_body) -> Image.Image:
    """MUI page: 57 px header band (title + brand art on the right) + content."""
    page = page_background(accent).resize(PAGE).convert('RGB')
    draw = ImageDraw.Draw(page)
    draw.rectangle((0, 0, PAGE[0], 57), fill=(14, 17, 16))
    draw.line((0, 57, PAGE[0], 57), fill=(38, 46, 42))
    draw.text((18, 18), title, font=font('SemiBold', 11), fill=TEXT)
    draw.text((18, 35), subtitle, font=font('Regular', 8), fill=MUTED)
    page.paste(header(accent), (PAGE[0] - HEADER[0], 0))
    draw_body(page, draw)
    return page


def preview() -> None:
    shots = os.path.join(ROOT, 'docs', 'screens')
    os.makedirs(shots, exist_ok=True)
    page_w = PAGE[0]

    def welcome_body(page, draw):
        draw.text((18, 74), 'Добро пожаловать в мастер', font=font('Bold', 13), fill=TEXT)
        draw.multiline_text((18, 96), 'Он установит Verdant Launcher в вашу\nпапку пользователя. Нажмите «Далее».',
                            font=font('Regular', 9), fill=MUTED, spacing=5)
        draw.text((18, 146), 'ПАПКА УСТАНОВКИ', font=font('SemiBold', 7), fill=(150, 168, 159))
        draw.rounded_rectangle((18, 160, page_w - 18, 184), radius=3, fill=(30, 35, 32), outline=(56, 66, 60))
        draw.text((26, 172), r'C:\Users\Player\AppData\Local\Programs\Verdant',
                  font=font('Regular', 8), fill=TEXT, anchor='lm')
        draw.text((18, 200), 'Ярлыки появятся на Рабочем столе и в', font=font('Regular', 8), fill=(120, 134, 126))
        draw.text((18, 212), 'меню «Пуск».', font=font('Regular', 8), fill=(120, 134, 126))

    _window(_page('emerald', 'Установка Verdant Launcher', 'Будет установлена версия 1.0.0', welcome_body),
            'emerald', [('Далее >', 'primary'), ('Отмена', 'ghost')]).save(os.path.join(shots, 'installer-welcome.png'))

    def progress_body(page, draw):
        draw.text((18, 74), 'Установка', font=font('Bold', 13), fill=TEXT)
        draw.multiline_text((18, 96), 'Пожалуйста, подождите. Идёт установка\nVerdant Launcher на ваш компьютер.',
                            font=font('Regular', 9), fill=MUTED, spacing=5)
        for i, line in enumerate(['Извлечение: app.asar', 'Создание ярлыков…', 'Запись реестра…']):
            draw.text((18, 136 + i * 14), line, font=font('Regular', 8), fill=(150, 168, 159))
        draw.rounded_rectangle((18, 196, page_w - 18, 204), radius=4, fill=(28, 35, 32), outline=(44, 52, 48))
        draw.rounded_rectangle((18, 196, 18 + int((page_w - 36) * 0.62), 204), radius=4, fill=EMERALD)
        draw.text((18, 216), 'Установка Verdant Launcher 1.0.0', font=font('Medium', 8), fill=TEXT)
        draw.text((page_w - 18, 216), '62%', font=font('SemiBold', 8), fill=EMERALD, anchor='ra')

    _window(_page('emerald', 'Установка Verdant Launcher', 'Это может занять несколько минут', progress_body),
            'emerald', [('Закрыть', 'ghost')]).save(os.path.join(shots, 'installer-progress.png'))

    def finish_body(page, draw):
        draw.text((18, 74), 'Установка завершена', font=font('Bold', 13), fill=TEXT)
        draw.multiline_text((18, 96), 'Verdant Launcher установлен.\nНажмите «Готово», чтобы закрыть мастер.',
                            font=font('Regular', 9), fill=MUTED, spacing=5)
        draw.rounded_rectangle((18, 142, 32, 156), radius=3, fill=EMERALD)
        draw.line((22, 149, 24, 152), fill=(4, 26, 18), width=2)
        draw.line((24, 152, 29, 145), fill=(4, 26, 18), width=2)
        draw.text((40, 149), 'Запустить Verdant Launcher', font=font('Medium', 9), fill=TEXT, anchor='lm')

    _window(_page('emerald', 'Установка Verdant Launcher', 'Готово', finish_body),
            'emerald', [('Готово', 'primary')]).save(os.path.join(shots, 'installer-finish.png'))

    def uninstall_body(page, draw):
        draw.text((18, 74), 'Удаление Verdant Launcher', font=font('Bold', 13), fill=TEXT)
        draw.multiline_text((18, 96), 'Приложение и его ярлыки будут удалены\nс этого компьютера.',
                            font=font('Regular', 9), fill=MUTED, spacing=5)
        draw.rounded_rectangle((18, 142, 32, 156), radius=3, fill=EMERALD)
        draw.line((22, 149, 24, 152), fill=(4, 26, 18), width=2)
        draw.line((24, 152, 29, 145), fill=(4, 26, 18), width=2)
        draw.text((40, 149), 'Удалить настройки и сохранения', font=font('Medium', 9), fill=TEXT, anchor='lm')
        draw.text((40, 166), r'Сборки, моды и миры в %APPDATA%\Verdant', font=font('Regular', 8), fill=MUTED)
        draw.text((18, 198), 'Файлы Minecraft в общей папке', font=font('Regular', 8), fill=(120, 134, 126))
        draw.text((18, 210), 'не затрагиваются.', font=font('Regular', 8), fill=(120, 134, 126))

    _window(_page('rose', 'Удаление Verdant Launcher', 'Verdant Launcher 1.0.0', uninstall_body),
            'rose', [('Удалить', 'danger'), ('Отмена', 'ghost')]).save(os.path.join(shots, 'uninstaller.png'))

    print('previews written to docs/screens')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--preview', action='store_true', help='also render docs/screens previews')
    args = parser.parse_args()
    build()
    if args.preview:
        preview()
