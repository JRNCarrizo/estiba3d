# -*- coding: utf-8 -*-
"""Arma el procedimiento del operario de depósito con el estilo de la bodega."""
import os
import tempfile
from PIL import Image
from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_LINE_SPACING, WD_TAB_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor, Twips

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOC = os.path.join(ROOT, "doc")
CAP = os.path.join(ROOT, "capturas")
OUT = os.path.join(DOC, "Procedimiento_Operario_de_Deposito.docx")
LOGO_SRC = os.path.join(DOC, "logobodega2.jpg")

NAVY = RGBColor(0x0E, 0x2A, 0x4A)
GOLD = RGBColor(0xC4, 0xA3, 0x5A)
INK = RGBColor(0x1A, 0x24, 0x33)
NAVY_HEX = "0E2A4A"
GOLD_HEX = "C4A35A"
CREAM = "F8F4EA"
ICE = "F3F6FA"


def crop_logo(src, dest, pad=8):
    im = Image.open(src).convert("RGBA")
    bg = im.getpixel((0, 0))
    pix = im.load()
    w, h = im.size

    def ink(px):
        return abs(px[0] - bg[0]) + abs(px[1] - bg[1]) + abs(px[2] - bg[2]) > 40

    minx, miny, maxx, maxy = w, h, 0, 0
    for y in range(h):
        for x in range(w):
            if ink(pix[x, y]):
                if x < minx:
                    minx = x
                if y < miny:
                    miny = y
                if x > maxx:
                    maxx = x
                if y > maxy:
                    maxy = y
    minx = max(0, minx - pad)
    miny = max(0, miny - pad)
    maxx = min(w - 1, maxx + pad)
    maxy = min(h - 1, maxy + pad)
    cropped = im.crop((minx, miny, maxx + 1, maxy + 1))
    out = Image.new("RGB", cropped.size, (255, 255, 255))
    out.paste(cropped, mask=cropped.split()[-1])
    out.save(dest, "PNG")
    return out.size


def crop_figure(src, dest, pad=28):
    im = Image.open(src).convert("RGB")
    w, h = im.size
    bg = im.getpixel((0, 0))
    pix = im.load()

    def far(px):
        return abs(px[0] - bg[0]) + abs(px[1] - bg[1]) + abs(px[2] - bg[2]) > 36

    minx, miny, maxx, maxy = w, h, 0, 0
    for y in range(0, h, 2):
        for x in range(0, w, 2):
            if far(pix[x, y]):
                if x < minx:
                    minx = x
                if y < miny:
                    miny = y
                if x > maxx:
                    maxx = x
                if y > maxy:
                    maxy = y
    minx = max(0, minx - pad)
    miny = max(0, miny - pad)
    maxx = min(w - 1, maxx + pad)
    maxy = min(h - 1, maxy + pad)
    im.crop((minx, miny, maxx + 1, maxy + 1)).save(dest, "PNG")


def font(run, name, size, color, bold=False, italic=False):
    run.font.name = name
    run.font.size = Pt(size)
    run.font.color.rgb = color
    run.bold = bold
    run.italic = italic
    rpr = run._element.get_or_add_rPr()
    rfonts = rpr.find(qn("w:rFonts"))
    if rfonts is None:
        rfonts = OxmlElement("w:rFonts")
        rpr.append(rfonts)
    for attr in ("w:ascii", "w:hAnsi", "w:cs", "w:eastAsia"):
        rfonts.set(qn(attr), name)


def shade(cell, color):
    tcpr = cell._tc.get_or_add_tcPr()
    shd = tcpr.find(qn("w:shd"))
    if shd is None:
        shd = OxmlElement("w:shd")
        tcpr.append(shd)
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), color)


def margins(cell, dxa=70):
    tcpr = cell._tc.get_or_add_tcPr()
    tcmar = OxmlElement("w:tcMar")
    for edge in ("top", "left", "bottom", "right"):
        node = OxmlElement(f"w:{edge}")
        node.set(qn("w:w"), str(dxa))
        node.set(qn("w:type"), "dxa")
        tcmar.append(node)
    tcpr.append(tcmar)


def borders(table, color=GOLD_HEX, sz="8"):
    tblpr = table._tbl.tblPr
    existing = tblpr.find(qn("w:tblBorders"))
    if existing is not None:
        tblpr.remove(existing)
    box = OxmlElement("w:tblBorders")
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        node = OxmlElement(f"w:{edge}")
        node.set(qn("w:val"), "single")
        node.set(qn("w:sz"), sz)
        node.set(qn("w:space"), "0")
        node.set(qn("w:color"), color)
        box.append(node)
    tblpr.append(box)


def no_borders(table):
    borders(table, color="FFFFFF", sz="0")
    tblpr = table._tbl.tblPr
    box = tblpr.find(qn("w:tblBorders"))
    for edge in box:
        edge.set(qn("w:val"), "nil")


def para_border(paragraph, color=GOLD_HEX, sz="12"):
    ppr = paragraph._p.get_or_add_pPr()
    pbdr = OxmlElement("w:pBdr")
    bottom = OxmlElement("w:bottom")
    bottom.set(qn("w:val"), "single")
    bottom.set(qn("w:sz"), sz)
    bottom.set(qn("w:space"), "1")
    bottom.set(qn("w:color"), color)
    pbdr.append(bottom)
    ppr.append(pbdr)


def para_top_border(paragraph, color=GOLD_HEX, sz="12"):
    ppr = paragraph._p.get_or_add_pPr()
    pbdr = OxmlElement("w:pBdr")
    top = OxmlElement("w:top")
    top.set(qn("w:val"), "single")
    top.set(qn("w:sz"), sz)
    top.set(qn("w:space"), "1")
    top.set(qn("w:color"), color)
    pbdr.append(top)
    ppr.append(pbdr)


def keep_with_next(paragraph):
    paragraph.paragraph_format.keep_with_next = True


def page_field(paragraph):
    run = paragraph.add_run()
    font(run, "Calibri", 9, NAVY)
    begin = OxmlElement("w:fldChar")
    begin.set(qn("w:fldCharType"), "begin")
    instr = OxmlElement("w:instrText")
    instr.set(qn("xml:space"), "preserve")
    instr.text = " PAGE "
    end = OxmlElement("w:fldChar")
    end.set(qn("w:fldCharType"), "end")
    run._r.append(begin)
    run._r.append(instr)
    run._r.append(end)


def cell_text(cell, text, name, size, color, bold=False, align="left"):
    cell.text = ""
    p = cell.paragraphs[0]
    p.alignment = {
        "left": WD_ALIGN_PARAGRAPH.LEFT,
        "center": WD_ALIGN_PARAGRAPH.CENTER,
    }[align]
    p.paragraph_format.space_before = Pt(1)
    p.paragraph_format.space_after = Pt(1)
    p.paragraph_format.line_spacing = 1.05
    run = p.add_run(text)
    font(run, name, size, color, bold=bold)
    return p


def set_widths(table, widths):
    table.autofit = False
    table.allow_autofit = False
    tbl = table._tbl
    tblpr = tbl.tblPr
    tblw = tblpr.find(qn("w:tblW"))
    if tblw is None:
        tblw = OxmlElement("w:tblW")
        tblpr.append(tblw)
    total = sum(widths)
    tblw.set(qn("w:w"), str(int(total)))
    tblw.set(qn("w:type"), "dxa")
    grid = tbl.find(qn("w:tblGrid"))
    if grid is not None:
        for child in list(grid):
            grid.remove(child)
    else:
        grid = OxmlElement("w:tblGrid")
        tblpr.addnext(grid)
    for w in widths:
        gc = OxmlElement("w:gridCol")
        gc.set(qn("w:w"), str(int(w)))
        grid.append(gc)
    for row in table.rows:
        for cell, w in zip(row.cells, widths):
            cell.width = Twips(w)
            tcw = cell._tc.get_or_add_tcPr().find(qn("w:tcW"))
            if tcw is None:
                tcw = OxmlElement("w:tcW")
                cell._tc.get_or_add_tcPr().append(tcw)
            tcw.set(qn("w:w"), str(int(w)))
            tcw.set(qn("w:type"), "dxa")


def add_h(doc, text):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(16)
    p.paragraph_format.space_after = Pt(6)
    keep_with_next(p)
    run = p.add_run(text)
    font(run, "Georgia", 16, NAVY, bold=True)
    para_border(p, GOLD_HEX, "12")
    return p


def add_h2(doc, text):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(11)
    p.paragraph_format.space_after = Pt(3)
    keep_with_next(p)
    run = p.add_run(text)
    font(run, "Georgia", 13, NAVY, bold=True)
    return p


def add_p(doc, text):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(1)
    p.paragraph_format.space_after = Pt(6)
    p.paragraph_format.line_spacing = 1.12
    run = p.add_run(text)
    font(run, "Calibri", 11, INK)
    return p


def add_rich(doc, parts):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(1)
    p.paragraph_format.space_after = Pt(6)
    p.paragraph_format.line_spacing = 1.12
    for text, bold in parts:
        run = p.add_run(text)
        font(run, "Calibri", 11, INK, bold=bold)
    return p


def add_bullet(doc, text, hang=0.45):
    p = doc.add_paragraph()
    p.paragraph_format.left_indent = Cm(0.7)
    p.paragraph_format.first_line_indent = Cm(-0.35)
    p.paragraph_format.space_before = Pt(0)
    p.paragraph_format.space_after = Pt(2)
    p.paragraph_format.line_spacing = 1.08
    mark = p.add_run("▸  ")
    font(mark, "Calibri", 11, GOLD, bold=True)
    run = p.add_run(text)
    font(run, "Calibri", 11, INK)
    return p


def add_step(doc, number, title, body):
    p = doc.add_paragraph()
    p.paragraph_format.left_indent = Cm(0.15)
    p.paragraph_format.space_before = Pt(2)
    p.paragraph_format.space_after = Pt(2)
    p.paragraph_format.line_spacing = 1.1
    num = p.add_run(f"{number}.  ")
    font(num, "Calibri", 11, GOLD, bold=True)
    lead = p.add_run(title + "  ")
    font(lead, "Calibri", 11, NAVY, bold=True)
    rest = p.add_run(body)
    font(rest, "Calibri", 11, INK)
    return p


def add_figure(doc, path, width, caption):
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(8)
    p.paragraph_format.space_after = Pt(1)
    keep_with_next(p)
    run = p.add_run()
    run.add_picture(path, width=Cm(width))
    cap = doc.add_paragraph()
    cap.alignment = WD_ALIGN_PARAGRAPH.CENTER
    cap.paragraph_format.space_before = Pt(1)
    cap.paragraph_format.space_after = Pt(8)
    cap.paragraph_format.keep_together = True
    label, _, rest = caption.partition(" ")
    # caption arrives as "Figura N. texto"
    if caption.startswith("Figura"):
        head, _, tail = caption.partition(". ")
        a = cap.add_run(head + ". ")
        font(a, "Calibri", 9.5, GOLD, bold=True)
        b = cap.add_run(tail)
        font(b, "Calibri", 9.5, NAVY, italic=True)
    else:
        b = cap.add_run(caption)
        font(b, "Calibri", 9.5, NAVY, italic=True)


def add_pair(doc, left, right, width=8.15):
    table = doc.add_table(rows=1, cols=2)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    no_borders(table)
    set_widths(table, [4950, 4950])
    for cell, (path, caption) in zip(table.rows[0].cells, (left, right)):
        margins(cell, 60)
        cell.text = ""
        pic = cell.paragraphs[0]
        pic.alignment = WD_ALIGN_PARAGRAPH.CENTER
        pic.paragraph_format.space_before = Pt(4)
        pic.paragraph_format.space_after = Pt(1)
        pic.add_run().add_picture(path, width=Cm(width))
        cap = cell.add_paragraph()
        cap.alignment = WD_ALIGN_PARAGRAPH.CENTER
        cap.paragraph_format.space_before = Pt(1)
        cap.paragraph_format.space_after = Pt(2)
        head, _, tail = caption.partition(". ")
        a = cap.add_run(head + ". ")
        font(a, "Calibri", 9, GOLD, bold=True)
        b = cap.add_run(tail)
        font(b, "Calibri", 9, NAVY, italic=True)
    spacer = doc.add_paragraph()
    spacer.paragraph_format.space_before = Pt(0)
    spacer.paragraph_format.space_after = Pt(4)


def info_table(doc, rows):
    table = doc.add_table(rows=len(rows), cols=2)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    borders(table)
    set_widths(table, [2700, 7200])
    for i, (label, value) in enumerate(rows):
        left, right = table.rows[i].cells
        margins(left, 80)
        margins(right, 80)
        shade(left, NAVY_HEX)
        shade(right, CREAM if i % 2 == 0 else "FFFFFF")
        cell_text(left, label, "Calibri", 11, GOLD, bold=True)
        cell_text(right, value, "Calibri", 11, NAVY)
    return table


def grid_table(doc, headers, rows):
    table = doc.add_table(rows=1 + len(rows), cols=len(headers))
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    borders(table)
    width = 9900 // len(headers)
    set_widths(table, [width] * len(headers))
    for cell, text in zip(table.rows[0].cells, headers):
        margins(cell, 70)
        shade(cell, NAVY_HEX)
        cell_text(cell, text, "Calibri", 10.5, GOLD, bold=True, align="center")
    for r, row in enumerate(rows):
        for cell, text in zip(table.rows[r + 1].cells, row):
            margins(cell, 70)
            shade(cell, "FFFFFF" if r % 2 else ICE)
            cell_text(cell, text, "Calibri", 10.5, INK, align="center")
    return table


def build():
    tmp = tempfile.mkdtemp(prefix="estiba-fig-")
    names = [
        "base",
        "base28",
        "p2",
        "p3",
        "unoproducto",
        "correcto",
        "incorrecto",
        "suma",
        "tresalto",
        "traba",
        "sintraba",
        "chatas",
    ]
    files = [
        "modo-libre-pallet-vacio-libre.png",
        "base-normal-28-cajas-tres.png",
        "2-pisos-trabados-56-libre.png",
        "3-pisos-trabados-84-libre.png",
        "modo-libre-pallet-vacio-libre-5.png",
        "modo-libre-pallet-vacio-libre-2.png",
        "modo-libre-pallet-vacio-libre-3.png",
        "modo-libre-pallet-vacio-libre-4.png",
        "modo-libre-pallet-vacio-libre-6.png",
        "modo-libre-pallet-vacio-libre-8.png",
        "modo-libre-pallet-vacio-libre-9.png",
        "modo-libre-pallet-vacio-libre-7.png",
    ]
    logo_path = os.path.join(tmp, "logo.png")
    print("logo", crop_logo(LOGO_SRC, logo_path))
    fig = {}
    for key, name in zip(names, files):
        dest = os.path.join(tmp, key + ".png")
        crop_figure(os.path.join(CAP, name), dest)
        fig[key] = dest

    doc = Document()
    section = doc.sections[0]
    section.page_width = Cm(21.0)
    section.page_height = Cm(29.7)
    section.left_margin = Cm(1.7)
    section.right_margin = Cm(1.7)
    section.top_margin = Cm(2.9)
    section.bottom_margin = Cm(1.7)
    section.header_distance = Cm(0.4)
    section.footer_distance = Cm(0.4)

    normal = doc.styles["Normal"]
    normal.font.name = "Calibri"
    normal.font.size = Pt(11)
    normal.font.color.rgb = INK
    rpr = normal.element.get_or_add_rPr()
    rfonts = rpr.find(qn("w:rFonts"))
    if rfonts is None:
        rfonts = OxmlElement("w:rFonts")
        rpr.append(rfonts)
    for attr in ("w:ascii", "w:hAnsi", "w:cs", "w:eastAsia"):
        rfonts.set(qn(attr), "Calibri")

    header = section.header.paragraphs[0]
    header.alignment = WD_ALIGN_PARAGRAPH.LEFT
    header.paragraph_format.tab_stops.add_tab_stop(Cm(17.6), WD_TAB_ALIGNMENT.RIGHT)
    header.paragraph_format.space_after = Pt(2)
    logo = header.add_run()
    logo.add_picture(logo_path, width=Cm(5.8))
    side = header.add_run("\tOperario de depósito")
    font(side, "Georgia", 11, NAVY, italic=True)
    para_border(header, GOLD_HEX, "14")

    footer = section.footer.paragraphs[0]
    footer.paragraph_format.tab_stops.add_tab_stop(Cm(17.6), WD_TAB_ALIGNMENT.RIGHT)
    footer.paragraph_format.space_before = Pt(2)
    para_top_border(footer, GOLD_HEX, "12")
    left = footer.add_run("Bodegas Esmeralda   ·   Procedimiento operativo")
    font(left, "Calibri", 9, NAVY)
    footer.add_run("\t")
    page_field(footer)

    kicker = doc.add_paragraph()
    kicker.paragraph_format.space_before = Pt(2)
    kicker.paragraph_format.space_after = Pt(0)
    kr = kicker.add_run("LOGÍSTICA Y DISTRIBUCIÓN")
    font(kr, "Calibri", 10, GOLD, bold=True)

    title = doc.add_paragraph()
    title.paragraph_format.space_before = Pt(0)
    title.paragraph_format.space_after = Pt(0)
    tr = title.add_run("Procedimiento operativo")
    font(tr, "Georgia", 24, NAVY, bold=True)

    sub = doc.add_paragraph()
    sub.paragraph_format.space_before = Pt(0)
    sub.paragraph_format.space_after = Pt(8)
    sr = sub.add_run("Operario de depósito")
    font(sr, "Georgia", 16, GOLD, italic=True)
    para_border(sub, GOLD_HEX, "18")

    add_h(doc, "1.  Datos generales")
    info_table(
        doc,
        [
            ("Empresa", "Bodegas Esmeralda — Logística y distribución"),
            ("Sector", "Depósito"),
            ("Puesto", "Operario de depósito"),
            ("Horario", "7:00 a 16:30"),
            ("Reporta a", "Encargado"),
            ("Versión", "1.1"),
            ("Fecha", "21 de noviembre de 2026"),
        ],
    )

    add_h(doc, "2.  Alcance")
    add_p(
        doc,
        "Este procedimiento aplica a los operarios del depósito durante toda la jornada, de 7:00 a 16:30. Cubre el inicio del día, el orden del sector, la verificación de las descargas que vuelven, la reposición y el armado de las cargas de los transportes de la empresa, que son alrededor de 23 o 24 unidades.",
    )

    add_h(doc, "3.  Responsabilidades")
    for item in [
        "Reportar al encargado y seguir sus indicaciones.",
        "Armar cada carga en el orden de las planillas y según la norma de este procedimiento.",
        "Consultar a control o al encargado ante un faltante, una diferencia o cualquier duda, antes de seguir.",
        "Verificar lo que marque control y corregirlo cuando el error sea real.",
        "Mantener el depósito ordenado y limpio, y cuidar los equipos de trabajo.",
        "El planillero del equipo dirige al grupo, organiza el armado, colabora con el resto y firma la planilla al terminar.",
    ]:
        add_bullet(doc, item)

    add_h(doc, "4.  Equipamiento y seguridad")
    for item in [
        "Ropa de trabajo y calzado de seguridad. El uso es obligatorio.",
        "Birome, cúter y resaltador.",
        "Zorras eléctricas. Se usan durante todo el armado de los pedidos y también para repartir las descargas.",
        "Apiladoras eléctricas. Bajan los pallets de las filas de producto y los montan cuando se hace la reposición.",
        "Stretch. En el primer depósito se enfarda a mano. En el segundo depósito hay enfardadora eléctrica.",
    ]:
        add_bullet(doc, item)

    add_h(doc, "5.  La jornada")
    add_p(
        doc,
        "Las tareas siguen, en general, este orden. Los equipos son de 3 o 4 personas. El encargado puede cambiar la prioridad del día.",
    )

    add_h2(doc, "5.1  Inicio")
    add_p(
        doc,
        "Ingresar a las 7:00 con la ropa de trabajo y el calzado de seguridad. Tomar birome y cúter, revisar las planillas pendientes y confirmar con el encargado cómo queda organizado el equipo.",
    )

    add_h2(doc, "5.2  Cargas que quedaron del día anterior")
    add_p(
        doc,
        "Son las cargas sin terminar que tienen que salir temprano. Son la primera prioridad de la mañana y se arman como indica el punto 6.",
    )

    add_h2(doc, "5.3  Orden y limpieza")
    add_p(
        doc,
        "Juntar los cartones y el stretch que se usaron. Recorrer el depósito y dejarlo ordenado.",
    )

    add_h2(doc, "5.4  Cajas dañadas")
    add_p(
        doc,
        "En esa recorrida se buscan cajas de cartón rotas y cajas de madera desarmadas.",
    )
    for item in [
        "Si hay cajas de reposición, se reemplaza la dañada con una de ese sector.",
        "Si no hay, la caja dañada se lleva al sector de acumulación. Cuando llega el insumo se cambia, y el producto vuelve al stock.",
        "Si se rompe el contenido, por ejemplo botellas, se limpia en el momento: se retiran los vidrios y los residuos y se deja la zona en condiciones para seguir trabajando.",
        "Cada rotura se anota en una lista. Después esa lista se carga en el sistema, en roturas y pérdidas.",
    ]:
        add_bullet(doc, item)

    add_h2(doc, "5.5  Roturas y pérdidas")
    add_p(
        doc,
        "Anotar el producto y la cantidad. Después cargar la lista en el sistema, en la sección de roturas y pérdidas.",
    )

    add_h2(doc, "5.6  Segunda verificación de las descargas")
    add_p(
        doc,
        "Las descargas son los productos que vuelven de los transportes porque no se entregaron o fueron rechazados. Otro sector ya las ingresó con una planilla. La tarea del depósito es la segunda verificación.",
    )
    add_step(doc, "1", "Retirar la planilla.", "Se busca en la oficina de administración la planilla con la que se ingresó la descarga.")
    add_step(doc, "2", "Controlar.", "Se compara el producto con la planilla y se marca con resaltador lo que ya se verificó.")
    add_step(doc, "3", "Si hay una diferencia.", "Se avisa a control. Control la corrige cuando corresponde.")
    add_step(doc, "4", "Repartir.", "El producto verificado vuelve a su lugar con la zorra eléctrica.")
    add_step(doc, "5", "Cerrar.", "Las planillas controladas se entregan en la oficina de depósito.")

    add_h2(doc, "5.7  Reposición")
    for item in [
        "Durante el armado, cuando se termina el pallet que se está usando, se baja otro de la fila con la apiladora.",
        "En los tiempos libres se completan de nuevo los lugares de picking: se montan, con la apiladora, pallets que están en los sectores de almacenamiento.",
        "Si el producto se acabó, se le pide al clarkista que traiga pallets desde almacenamiento.",
        "La mercadería que llega en camiones desde Mendoza se guarda primero y después se lleva a su sector. Parte de esa mercadería la acomoda el propio equipo de depósito.",
        "El stretch se repone en todos los sectores, porque se usa durante toda la jornada.",
    ]:
        add_bullet(doc, item)

    add_h2(doc, "5.8  Segundas vueltas")
    add_p(
        doc,
        "Se arman las cargas de segunda vuelta de los transportes, con el mismo procedimiento del punto 6.",
    )

    add_h2(doc, "5.9  Cargas del día siguiente")
    add_p(
        doc,
        "Cuando terminan las segundas vueltas se empieza con las cargas del día siguiente. A veces se llega a armar todo. Lo que queda sin terminar pasa a ser pendiente del día siguiente.",
    )

    add_h2(doc, "5.10  Cierre")
    add_p(
        doc,
        "Controlar la batería de las zorras eléctricas y de las apiladoras, y ponerlas a cargar si hace falta. Dejar el depósito ordenado y retirarse a las 16:30.",
    )

    add_h(doc, "6.  Cómo se arma una carga")
    add_h2(doc, "6.1  Pasos")
    add_step(doc, "1", "Tomar la planilla.", "Siempre la que está arriba del planillero. El orden ya está definido según qué transporte carga primero, y se respeta. En el monitor de pendientes figura el número de cada planilla.")
    add_step(doc, "2", "Iniciarla en la computadora.", "Al iniciarla, la planilla pasa a la columna “en preparación”. Administración ve la misma pantalla y sigue la trazabilidad.")
    add_step(doc, "3", "Leer y repartir el trabajo.", "La planilla trae el código, la descripción y la cantidad de cada producto. Hay dos depósitos: uno en el sector de trabajo y otro al que se entra por el andén exterior. En la planilla se marca qué se arma en cada uno.")
    add_step(doc, "4", "Calcular los pallets.", "Se hace un cálculo aproximado de cuántos pallets van a hacer falta, como se explica en el punto 6.2.")
    add_step(doc, "5", "Armar.", "Se respeta la norma de armado (6.3), la traba (6.4), las cosechas (6.5) y el uso de las cajas chatas y de madera (6.6).")
    add_step(doc, "6", "Enfardar.", "Como mínimo, dos vueltas de stretch por piso, para que el pallet quede firme. En el primer depósito se enfarda a mano. En el segundo se usa la enfardadora eléctrica.")
    add_step(doc, "7", "Llevar al andén.", "Cada pallet se deja donde indique control. El primero lleva la copia de la planilla de carga y se ubica primero, de izquierda a derecha. Si después se coloca otro pallet a su izquierda, la planilla se pasa a ese, para que se vea dónde empieza la carga.")
    add_step(doc, "8", "Cerrar la planilla.", "Mientras se arma se van tildando los productos. Al terminar se anota cuántos pallets se armaron y cuántos fueron pallets enteros sacados. Firma el planillero.")
    add_step(doc, "9", "Entregar.", "La planilla se deja en el planillero de planillas realizadas y se marca finalizada en la computadora. En el monitor pasa a la columna “control”.")

    add_h2(doc, "6.2  Cuántas cajas entran")
    add_p(
        doc,
        "La caja común va parada: mide 33 cm de alto y su base es de 16,67 cm por 25 cm. De frente entran 7 cajas, que ocupan 116,7 cm y quedan centradas en los 120 cm del pallet. Entran 4 filas de 25 cm, justas en los 100 cm del otro lado.",
    )
    add_p(doc, "Con esas medidas, una base completa y los pallets de trabajo quedan así:")
    grid_table(
        doc,
        ["Armado", "Cajas comunes"],
        [
            ["Un cuarto, una fila", "7"],
            ["Media base, un lado del centro", "14"],
            ["Base completa", "28"],
            ["Pallet de 2 pisos", "56"],
            ["Pallet de 3 pisos", "84"],
        ],
    )
    add_p(
        doc,
        "Ejemplo: 140 cajas comunes son un pallet de 2 pisos (56) más uno de 3 pisos (84). El cálculo es aproximado, porque no todas las cajas ocupan lo mismo. Una caja de madera equivale a dos cajas comunes. Como referencia de carga, un camión grande lleva hasta 8 o 10 pallets y una Sprinter, de 3 a 4.",
    )
    add_figure(
        doc,
        fig["base"],
        14.2,
        "Figura 1. Las líneas de centro parten el pallet. De un lado entran 14 cajas comunes y un cuarto son 7. La base completa son 28.",
    )
    add_figure(
        doc,
        fig["base28"],
        14.2,
        "Figura 2. Base completa de 28 cajas comunes: 7 de frente y 4 filas.",
    )
    add_figure(
        doc,
        fig["p2"],
        13.2,
        "Figura 3. Pallet de 2 pisos: 56 cajas. El piso de arriba va en sentido contrario, para trabar.",
    )
    add_figure(
        doc,
        fig["p3"],
        12.2,
        "Figura 4. Pallet de 3 pisos: 84 cajas. Cada piso traba al de abajo.",
    )

    add_h2(doc, "6.3  Norma de armado")
    add_p(
        doc,
        "Control cuenta lo que se ve arriba y da por sentado que, en el centro, abajo hay lo mismo. Por eso la estiba tiene que poder leerse desde el centro hacia afuera.",
    )
    for item in [
        "La base sale del centro del pallet hacia un costado, o hacia los dos costados.",
        "El piso de arriba va trabado, en posición contraria al de abajo.",
        "Los huecos del piso de arriba quedan siempre hacia afuera. Ahí se puede ubicar un producto de una sola caja.",
        "No se deja un hueco en el medio y no se tapa un producto con otro. Si no se ve qué hay abajo, control no puede verificarlo.",
        "El pallet queda lo más parejo posible, para poder montarlo sobre otro cuando el transporte lo pide.",
        "Las etiquetas quedan a la vista. Si la caja no trae referencia, se anota con discreción el código, la cosecha o los dos.",
    ]:
        add_bullet(doc, item)
    add_p(doc, "La cantidad cambia según la planilla. La lógica no cambia:")
    for item in [
        "15 cajas en 3 de alto: base de 5, desde el centro hacia un costado.",
        "30 cajas en 3 de alto: dos bases de 5, una hacia cada lado, o una sola base de 10 hacia un costado.",
        "5 cajas en 2 de alto: base de 3 y dos cajas arriba.",
    ]:
        add_bullet(doc, item)
    add_figure(
        doc,
        fig["unoproducto"],
        12.4,
        "Figura 5. Un mismo producto, 28 cajas, en 3 de alto. La base sale del centro hacia el costado, los pisos se traban y el espacio libre queda hacia afuera.",
    )
    add_p(
        doc,
        "En las figuras que siguen, el color solo distingue un producto de otro. No es el color real de la caja.",
    )
    add_pair(
        doc,
        (
            fig["correcto"],
            "Figura 6. Así se arma. Planilla de ejemplo en 2 de alto: 10 marrones, 5 violetas, 2 azules, 1 gris y 7 verdes. Los huecos van hacia afuera, para contar desde el centro.",
        ),
        (
            fig["incorrecto"],
            "Figura 7. Así no. El hueco quedó en el medio. Si encima se apoya otro producto, deja de verse lo que hay abajo y el control no se puede hacer.",
        ),
        7.7,
    )
    add_figure(
        doc,
        fig["suma"],
        13.4,
        "Figura 8. La estiba se completa de un lado: se suman 7 cajas marrones y, encima, 2 grises. No se tapa lo que control tiene que ver.",
    )
    add_figure(
        doc,
        fig["tresalto"],
        12.6,
        "Figura 9. Varios productos en 3 de alto: 28 marrones, 25 bordó, 5 azules, 1 gris y 3 verdes. Las bases se superponen y los espacios libres quedan hacia afuera.",
    )

    add_h2(doc, "6.4  Cuando no hay traba")
    add_p(
        doc,
        "Si la cantidad no permite trabar el piso, el armado se empieza con las cajas atravesadas. Cruzadas se agarran mejor y baja de forma importante la chance de que se caigan al mover el pallet.",
    )
    add_p(
        doc,
        "No se dejan columnas en la misma posición, una caja arriba de la otra y sin cruzar. En el traslado, y sobre todo al frenar, esas columnas se mueven más y tienen más probabilidad de caer.",
    )
    add_pair(
        doc,
        (
            fig["traba"],
            "Figura 10. Buena práctica. Sin traba, se empieza con las cajas atravesadas. Así tienen mejor agarre durante el desplazamiento.",
        ),
        (
            fig["sintraba"],
            "Figura 11. Así no. Las cantidades no se traban. Al trasladar y al frenar se mueven más y es más probable que se caigan.",
        ),
        7.7,
    )

    add_h2(doc, "6.5  Cosechas")
    add_p(
        doc,
        "Las cosechas se respetan siempre, en todos los armados. No es una recomendación: es una regla.",
    )

    add_h2(doc, "6.6  Cajas chatas y cajas de madera")
    for item in [
        "Con cajas chatas, la cantidad mayor va abajo y la menor arriba.",
        "La chata de 6 botellas, acostada, ocupa la base de cuatro cajas comunes: dos de frente por dos filas. Mide 33,3 cm por 50 cm y 8,3 cm de alto. Cuatro apiladas equivalen al alto de una caja común. En 2 de alto entran 8 y en 3 de alto, 12.",
        "La de 4 botellas sigue la misma lógica. Acostada es casi cuadrada: 33,3 cm por 33 cm y 8,3 cm de alto.",
        "La caja de madera lleva dos cajas comunes, una al lado de la otra, y cuenta como dos.",
        "No se apoyan dos cajas de un producto sobre una sola caja de otro. Al reparto le queda incómodo sacarlas.",
    ]:
        add_bullet(doc, item)
    add_figure(
        doc,
        fig["chatas"],
        12.2,
        "Figura 12. Cajas chatas de 6 y de 4 botellas. Las cantidades mayores quedan abajo y las menores arriba, para usar el espacio y dejar la estiba firme.",
    )

    add_h(doc, "7.  Cuando algo no cierra")
    grid_table(
        doc,
        ["Situación", "Qué se hace"],
        [
            ["Falta un producto o no coincide con la planilla", "Se consulta a control o al encargado antes de seguir."],
            ["Control marca un error en un pallet", "Se verifica. Si el error es real, se corrige."],
            ["Caja rota o desarmada", "Se reemplaza como indica el punto 5.4."],
            ["Se rompe producto en el depósito", "Se limpia la zona y se anota la rotura para cargarla en el sistema."],
            ["Diferencia en una descarga", "Se avisa a control, que la corrige si corresponde."],
            ["Se terminó el producto del picking", "Se baja otro pallet de la fila o se le pide al clarkista que traiga de almacenamiento."],
        ],
    )
    # The situation column needs more width. Rebuild is hard after the fact;
    # set_widths already used equal columns. Adjust below by rewriting widths.
    last = doc.tables[-1]
    set_widths(last, [4500, 5400])
    for row in last.rows:
        for cell in row.cells:
            for p in cell.paragraphs:
                p.alignment = WD_ALIGN_PARAGRAPH.LEFT

    add_h(doc, "8.  Registros")
    for item in [
        "Planilla de carga. Trae código, descripción y cantidad. Se tilda durante el armado.",
        "Planilleros. En uno están las planillas pendientes. A la izquierda, el de las planillas realizadas.",
        "Monitor y computadora. Muestran el estado de cada planilla: pendiente, en preparación o control.",
        "Planilla de descarga. Se retira de la oficina de administración, se usa en la segunda verificación y se entrega en la oficina de depósito.",
        "Lista de roturas. Ahí se anota lo que se rompe. Después se carga en el sistema, en roturas y pérdidas.",
    ]:
        add_bullet(doc, item)

    core = doc.core_properties
    core.title = "Procedimiento operativo — Operario de depósito"
    core.subject = "Bodegas Esmeralda — Logística y distribución"
    core.category = "Procedimiento"
    core.comments = ""

    doc.save(OUT)
    print(OUT)


if __name__ == "__main__":
    build()
