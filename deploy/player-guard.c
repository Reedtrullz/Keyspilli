#if !defined(__linux__) || !defined(__x86_64__)
#include <stdio.h>
int main(void) { fputs("player guard requires native Linux amd64\n", stderr); return 125; }
#else
#define _GNU_SOURCE
#include <arpa/inet.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <signal.h>
#include <linux/audit.h>
#include <linux/filter.h>
#include <linux/seccomp.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/resource.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <sys/wait.h>
#include <unistd.h>

/* Case-specific Linux amd64 ABI4 policy, not a general sandbox interface. */
struct ruleset { uint64_t fs, net; };
struct path_rule { uint64_t access; int32_t fd; } __attribute__((packed));
struct port_rule { uint64_t access, port; };
static const uint64_t fs_mask = (1ULL << 15) - 1;
static const uint64_t read_mask = (1ULL << 2) | (1ULL << 3);
static void die(const char *where) { perror(where); exit(125); }
static void need(int ok, const char *where) { if (!ok) { errno = EINVAL; die(where); } }
static int under(const char *p, const char *root) {
    size_t n = strlen(root); return !strncmp(p, root, n) && (p[n] == '/' || p[n] == 0);
}
static void path_allow(int fd, const char *path, uint64_t access) {
    int p = open(path, O_PATH | O_CLOEXEC); if (p < 0) die(path);
    struct stat st; if (fstat(p, &st)) die("fstat");
    if (!S_ISDIR(st.st_mode)) access &= (1ULL << 0) | (1ULL << 1) | (1ULL << 2) | (1ULL << 14);
    struct path_rule rule = {access, p};
    if (syscall(__NR_landlock_add_rule, fd, 1, &rule, 0)) die("landlock path");
    close(p);
}
static int permitted_executable(const char *p) {
    const char *base = strrchr(p, '/'); base = base ? base + 1 : p;
    return !strcmp(p, "/usr/local/bin/node")
        || (under(p, "/ms-playwright") && (!strcmp(base, "chrome") || !strcmp(base, "headless_shell")
            || !strcmp(base, "chrome-headless-shell") || !strcmp(base, "chrome_crashpad_handler")))
        || (under(p, "/qualification-source/node_modules") && strstr(p, "/@esbuild/linux-x64/bin/esbuild")
            && !strcmp(base, "esbuild"));
}
static void socket_filter(void) {
    struct sock_filter code[] = {
        BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, arch)),
        BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, AUDIT_ARCH_X86_64, 1, 0),
        BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS),
        BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr)),
        BPF_JUMP(BPF_JMP | BPF_JSET | BPF_K, 0x40000000, 0, 1),
        BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS),
        BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_socket, 1, 0),
        BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
        BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
        BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, AF_UNIX, 5, 0),
        BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, AF_INET, 1, 0),
        BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, AF_INET6, 0, 4),
        BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[1])),
        BPF_STMT(BPF_ALU | BPF_AND | BPF_K, 15),
        BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SOCK_STREAM, 0, 1),
        BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
        BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EPERM),
    };
    struct sock_fprog p = {(unsigned short)(sizeof(code) / sizeof(code[0])), code};
    if (prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, &p)) die("seccomp");
}
static void denied_open(const char *path, int flags) {
    errno = 0; int fd = open(path, flags); int e = errno; if (fd >= 0) close(fd);
    need(fd < 0 && (e == EACCES || e == EPERM), "private file was not permission denied");
}
static void probe(int forbidden, const char *phase) {
    const char *private[] = {"/sentinels/catalog", "/sentinels/media", "/sentinels/home", "/sentinels/credential", NULL};
    for (int i = 0; private[i]; i++) denied_open(private[i], O_RDONLY);
    denied_open("/sentinels/protected", O_WRONLY);
    pid_t pid = fork(); if (pid < 0) die("fork exec probe");
    if (!pid) { execl("/usr/bin/id", "id", NULL); _exit(errno == EACCES || errno == EPERM ? 0 : 125); }
    int status; need(waitpid(pid, &status, 0) == pid && WIFEXITED(status) && WEXITSTATUS(status) == 0, "unknown exec");
    int s = socket(AF_INET, SOCK_STREAM, 0); if (s < 0) die("allowed TCP socket");
    struct sockaddr_in a = {.sin_family = AF_INET, .sin_port = htons(3000), .sin_addr.s_addr = htonl(INADDR_LOOPBACK)};
    need(connect(s, (struct sockaddr *)&a, sizeof(a)) == 0, "owned TCP positive"); close(s);
    s = socket(AF_INET, SOCK_STREAM, 0); if (s < 0) die("TCP negative socket");
    a.sin_port = htons((uint16_t)forbidden); errno = 0; int rc = connect(s, (struct sockaddr *)&a, sizeof(a)), e = errno; close(s);
    need(rc < 0 && (e == EACCES || e == EPERM), "forbidden TCP");
    for (int i = 0; i < 2; i++) { errno = 0; s = socket(AF_INET, SOCK_DGRAM, 0); e = errno; if (s >= 0) close(s); need(s < 0 && e == EPERM, "UDP/DNS socket"); }
    printf("{\"phase\":\"%s\",\"privateReads\":4,\"protectedWrite\":true,\"unknownExec\":true,\"ownedTcp\":true,\"forbiddenTcp\":true,\"udpSocketDenied\":true,\"dnsSocketDenied\":true}\n", phase); fflush(stdout);
}
int main(int argc, char **argv) {
    if (argc == 6 && !strcmp(argv[1], "--init")) {
        need(getpid() == 1 && getuid() == 1000 && !strcmp(argv[2], "/usr/local/bin/node")
            && !strcmp(argv[3], "/qualification-source/deploy/player-guard-run.mjs") && !strcmp(argv[4], "--inside"), "owned namespace init only");
        pid_t child = fork(); if (child < 0) die("init fork");
        if (!child) { execv(argv[2], &argv[2]); _exit(125); }
        int status, result = 125, finished = 0, comma = 0;
        char rows[8192] = "";
        for (;;) {
            pid_t pid = waitpid(-1, &status, 0);
            if (pid < 0) { if (errno == EINTR) continue; need(errno == ECHILD && finished, "init wait"); break; }
            if (pid == child) { finished = 1; result = WIFEXITED(status) ? WEXITSTATUS(status) : 125; if (kill(-1, SIGKILL) && errno != ESRCH) die("namespace cleanup"); }
            else {
                char row[100]; int n = snprintf(row, sizeof(row), "%s{\"pid\":%d,\"signal\":%d}", comma ? "," : "", pid, WIFSIGNALED(status) ? WTERMSIG(status) : 0);
                need(n > 0 && strlen(rows) + (size_t)n < sizeof(rows), "reaper receipt limit"); strcat(rows, row); comma = 1;
            }
        }
        printf("{\"phase\":\"reaper\",\"remainingChildren\":0,\"reaped\":[%s]}\n", rows); fflush(stdout); return result;
    }
    need(argc > 4 && getuid() == 1000, "requires owned uid1000 container");
    char *end; long forbidden = strtol(argv[1], &end, 10); need(!*end && forbidden > 1024 && forbidden <= 65535 && forbidden != 3000, "forbidden port");
    int split = 2; while (split < argc && strcmp(argv[split], "--")) split++;
    need(split > 2 && split < 20 && split + 1 < argc, "exact executable list and command required");
    if (syscall(__NR_close_range, 3U, ~0U, 0)) die("close inherited descriptors");
    if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0)) die("no new privileges");
    int abi = (int)syscall(__NR_landlock_create_ruleset, NULL, 0, 1);
    if (abi < 0) die("Landlock ABI query");
    if (abi < 4) { fprintf(stderr, "player guard requires Landlock ABI4, observed %d\n", abi); return 125; }
    struct ruleset attr = {fs_mask, 3}; int fd = (int)syscall(__NR_landlock_create_ruleset, &attr, sizeof(attr), 0); if (fd < 0) die("landlock ruleset");
    const char *reads[] = {"/usr", "/lib", "/lib64", "/etc", "/proc", "/sys", "/app", "/qualification-source", "/ms-playwright", "/piano-input", NULL};
    const char *writes[] = {"/tmp", "/data", "/browser-results", "/dev/shm", NULL};
    for (int i = 0; reads[i]; i++) path_allow(fd, reads[i], read_mask);
    for (int i = 0; writes[i]; i++) path_allow(fd, writes[i], fs_mask & ~1ULL);
    path_allow(fd, "/dev/null", 6); path_allow(fd, "/dev/urandom", 4); path_allow(fd, "/dev/random", 4);
    path_allow(fd, "/lib64/ld-linux-x86-64.so.2", 5); /* ELF interpreter: file EXECUTE+READ only; missing path fails closed */
    char executables[8192] = "";
    for (int i = 2; i < split; i++) {
        char p[PATH_MAX]; need(realpath(argv[i], p) && permitted_executable(p), "unrecognized executable");
        need(strlen(executables) + strlen(p) + 2 < sizeof(executables) && !strchr(p, ':'), "executable list length");
        if (*executables) strcat(executables, ":");
        strcat(executables, p); path_allow(fd, p, 5);
    }
    struct port_rule port = {3, 3000}; if (syscall(__NR_landlock_add_rule, fd, 2, &port, 0)) die("landlock TCP port");
    if (syscall(__NR_landlock_restrict_self, fd, 0)) die("landlock restriction");
    close(fd); socket_filter();
    struct rlimit core = {0, 0}; if (setrlimit(RLIMIT_CORE, &core)) die("core limit");
    if (!strcmp(argv[split + 1], "--probe")) {
        probe((int)forbidden, "kernel-main"); pid_t pid = fork(); if (pid < 0) die("fork inherited probe");
        if (!pid) { probe((int)forbidden, "kernel-child"); _exit(0); }
        int status; need(waitpid(pid, &status, 0) == pid && WIFEXITED(status) && WEXITSTATUS(status) == 0, "inherited guard"); return 0;
    }
    need(!strcmp(argv[split + 1], "/usr/local/bin/node"), "only Node entry allowed");
    const char *keep[] = {"VERSION", "HOME", "TMPDIR", "PORT", "HOSTNAME", "PLAYWRIGHT_BROWSERS_PATH", "KEYSPILLI_DATA_DIR", "KEYSPILLI_ORIGIN", "KEYSPILLI_API_TOKEN", "KEYSPILLI_NATIVE_PROBE_SCOPE", "AUTH_SECRET", "KEYSPILLI_TUTORIAL_BETA", NULL};
    char *values[sizeof(keep) / sizeof(keep[0])] = {0}; for (int i = 0; keep[i]; i++) if (getenv(keep[i])) { values[i] = strdup(getenv(keep[i])); if (!values[i]) die("environment copy"); }
    if (clearenv()) die("clear environment");
    for (int i = 0; keep[i]; i++) if (values[i]) { if (setenv(keep[i], values[i], 1)) die("environment restore"); free(values[i]); }
    if (setenv("NODE_OPTIONS", "--require=/qualification-source/deploy/player-node-guard.cjs", 1) || setenv("PLAYER_EXECUTABLES", executables, 1) || setenv("PATH", "/usr/local/bin", 1)) die("guard environment");
    execv(argv[split + 1], &argv[split + 1]); die("Node entry");
}
#endif
