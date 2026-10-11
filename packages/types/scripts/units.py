"""Emit a Markdown table of every slot with a unit, per class, from schema/tma.yaml.

gen-markdown-datadict omits LinkML `unit`, which the data dictionary must show (SRD §9).
"""

import sys

from linkml_runtime.utils.schemaview import SchemaView


def main(path: str) -> None:
    sv = SchemaView(path)
    print("| Class | Slot | Unit (UCUM) |")
    print("| --- | --- | --- |")
    for cls in sorted(sv.all_classes()):
        for slot in sorted(sv.class_induced_slots(cls), key=lambda s: s.name):
            if slot.unit is not None and slot.unit.ucum_code:
                print(f"| {cls} | {slot.name} | `{slot.unit.ucum_code}` |")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "schema/tma.yaml")
