"""Create the original PaperLens macOS icon. Requires Pillow."""
from pathlib import Path
import math
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public"
OUT.mkdir(exist_ok=True)
SIZE = 1024


def bezier(points, steps=48):
    a, b, c, d = points
    return [(
        (1-t)**3*a[0]+3*(1-t)**2*t*b[0]+3*(1-t)*t*t*c[0]+t**3*d[0],
        (1-t)**3*a[1]+3*(1-t)**2*t*b[1]+3*(1-t)*t*t*c[1]+t**3*d[1],
    ) for t in (i/steps for i in range(steps+1))]


canvas = Image.new("RGBA", (SIZE, SIZE))
shadow = Image.new("RGBA", (SIZE, SIZE))
sd = ImageDraw.Draw(shadow)
sd.rounded_rectangle((105, 115, 919, 929), 185, fill=(44, 31, 81, 60))
canvas.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(20)))

mask = Image.new("L", (SIZE, SIZE))
ImageDraw.Draw(mask).rounded_rectangle((103, 91, 921, 909), 184, fill=255)
gradient = Image.new("RGBA", (SIZE, SIZE))
pixels = gradient.load()
for y in range(SIZE):
    for x in range(SIZE):
        t = min(1, max(0, (y-91)/818*.76 + (x-103)/818*.24))
        glow = max(0, 1-math.hypot((x-296)/600, (y-240)/650)) * 13
        pixels[x,y] = (int(157*(1-t)+113*t+glow), int(139*(1-t)+94*t+glow), int(225*(1-t)+197*t+glow), 255)
gradient.putalpha(mask)
canvas.alpha_composite(gradient)

# A bound book with distinct left and right pages. Curves keep the mark soft at all sizes.
left = ([(253,316)] + bezier([(253,316),(355,292),(454,312),(506,349)])
    + [(506,677)] + bezier([(506,677),(432,635),(345,625),(253,644)])
    + bezier([(253,644),(237,648),(226,638),(226,621)]) + [(226,345)]
    + bezier([(226,345),(226,329),(237,320),(253,316)]))
right = [(1024-x,y) for x,y in left]
book_shadow = Image.new("RGBA", (SIZE,SIZE))
bs = ImageDraw.Draw(book_shadow)
bs.polygon([(x,y+17) for x,y in left], fill=(51, 32, 113, 80))
bs.polygon([(x,y+17) for x,y in right], fill=(51, 32, 113, 80))
canvas.alpha_composite(book_shadow.filter(ImageFilter.GaussianBlur(17)))
draw = ImageDraw.Draw(canvas)
draw.polygon(left, fill=(255,255,255,255))
draw.polygon(right, fill=(246,243,255,255))

# Page lines echo the horizontal logic-chain blocks in the reading workspace.
for yy, width in [(408, 152), (456, 137), (504, 151), (552, 104)]:
    draw.line(bezier([(280,yy),(330,yy-9),(383,yy-1),(280+width,yy+18)]), fill=(184,170,228,255), width=13)
for yy, width in [(408, 152), (456, 137), (504, 151)]:
    draw.line([(1024-x,y) for x,y in bezier([(280,yy),(330,yy-9),(383,yy-1),(280+width,yy+18)])], fill=(174,157,221,255), width=13)

# Small precision mark: a bright four-point star, kept legible at Dock sizes.
star=[(755,209),(768,241),(802,255),(768,269),(755,301),(741,269),(708,255),(741,241)]
draw.polygon(star,fill=(239,251,242,255))

canvas.save(OUT / "app-icon.png")
canvas.save(OUT / "icon.icns", format="ICNS")
print("Created public/app-icon.png and public/icon.icns")
