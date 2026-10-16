"""Local MarkItDown PDF extraction, with a physical-page boundary preserved."""
import io
import json
import sys
from pathlib import Path
import pypdfium2 as pdfium
from markitdown import MarkItDown

def convert_pdf(filename):
    converter = MarkItDown(enable_plugins=False)
    pages = []
    with pdfium.PdfDocument(filename) as source:
        for i in range(len(source)):
            with pdfium.PdfDocument.new() as single:
                single.import_pages(source, [i])
                stream = io.BytesIO()
                single.save(stream)
                stream.seek(0)
                result = converter.convert_stream(stream, file_extension=".pdf")
                pages.append(result.markdown.strip())
    title = Path(filename).stem
    markdown = "# " + title + "\n\n" + "\n\n".join(
        f"## 第 {i + 1} 页\n\n{text}" for i, text in enumerate(pages)
    ) + "\n"
    return {"pages": pages, "markdown": markdown, "engine": "Microsoft MarkItDown 0.1.8"}

if __name__ == "__main__":
    result = convert_pdf(sys.argv[1])
    print(json.dumps(result, ensure_ascii=False) if "--json" in sys.argv else result["markdown"])
