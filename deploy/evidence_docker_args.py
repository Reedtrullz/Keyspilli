from dataclasses import dataclass


@dataclass
class Invocation:
    options: list[str]
    operands: list[str]


VALUES = {"--name", "-v", "--volume", "--tmpfs", "--entrypoint", "-e", "--env", "-p", "--publish", "--user", "-u",
          "--cap-drop", "--security-opt", "--cpus", "--memory", "--pids-limit", "--add-host", "--workdir", "-w",
          "--hostname", "--label", "--network", "--time", "--format", "--filter", "--tail", "--since",
          "--platform", "-f", "--file", "-t", "--tag", "--build-arg", "--target", "--progress"}
FLAGS = {"-d", "--detach", "--rm", "--read-only", "-i", "--interactive", "--tty", "--no-trunc", "-q", "-a", "-aq", "--pull=never"}


def parse(args: list[str], operation: str) -> Invocation:
    options: list[str] = []
    index = 0
    while index < len(args) and args[index].startswith("-"):
        token = args[index]
        if (operation != "build" and token == "-t") or (operation == "rm" and token == "-f"):
            options.append(token)
            index += 1
            continue
        if token in VALUES:
            if index + 1 >= len(args):
                raise ValueError("missing Docker option value")
            options.extend(args[index:index + 2])
            index += 2
        elif token in FLAGS or (operation == "rm" and token == "-f"):
            options.append(token)
            index += 1
        elif "=" in token and token.split("=", 1)[0] in VALUES:
            key, value = token.split("=", 1)
            options.extend((key, value))
            index += 1
        else:
            raise ValueError(f"unsupported managed Docker option {token}")
    return Invocation(options, args[index:])


def value(options: list[str], *names: str) -> list[str]:
    return [options[index + 1] for index, token in enumerate(options[:-1]) if token in names]
