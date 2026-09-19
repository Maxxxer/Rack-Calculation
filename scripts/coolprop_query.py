import json
import sys

import CoolProp.CoolProp as CP


def main():
    request = json.loads(sys.argv[1])
    fluid = request["fluid"]
    CP.set_reference_state(fluid, "IIR")
    value = CP.PropsSI(
        request["output"],
        request["name1"],
        float(request["value1"]),
        request["name2"],
        float(request["value2"]),
        fluid,
    )
    print("{:.17g}".format(value))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
