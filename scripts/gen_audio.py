"""合成欢快国风BGM与【单音】游戏音效（全部WAV，16-bit PCM, 44100Hz mono）"""
import math, struct, os, random

SAMPLE_RATE = 44100
OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'client4.0', 'assets')

def _wav(name, samples, sr=SAMPLE_RATE):
    os.makedirs(OUT_DIR, exist_ok=True)
    path = os.path.join(OUT_DIR, name)
    mx = max(0.001, max(abs(x) for x in samples))
    scale = 0.85 / mx
    n = len(samples)
    data = b''.join(struct.pack('<h', int(max(-32767, min(32767, s * scale * 32767)))) for s in samples)
    with open(path, 'wb') as f:
        f.write(b'RIFF' + struct.pack('<I', 36 + len(data)) + b'WAVE')
        f.write(b'fmt ' + struct.pack('<IHHIIHH', 16, 1, 1, sr, sr * 2, 2, 16))
        f.write(b'data' + struct.pack('<I', len(data)) + data)
    print(f'OK {name} ({n/sr:.2f}s)')

def env(t, dur, a=0.01, r=0.06):
    if t < a: return t / a
    if t > dur - r: return max(0, (dur - t) / r)
    return 1.0

def single_tone(freq, dur, vol=0.6, wave='sine', a=0.01, r=0.06):
    """单个纯净音（单一频率，无谐波/无滑音/无噪声叠加）"""
    n = int(dur * SAMPLE_RATE)
    out = [0.0] * n
    for i in range(n):
        t = i / SAMPLE_RATE
        phase = 2 * math.pi * freq * t
        if wave == 'sine':
            v = math.sin(phase)
        elif wave == 'triangle':
            v = 2 * math.asin(math.sin(phase)) / math.pi
        elif wave == 'square':
            v = 1.0 if (phase % (2*math.pi)) < math.pi else -1.0
        else:
            v = math.sin(phase)
        out[i] = v * vol * env(t, dur, a, r)
    return out

# ============ BGM：欢快明亮的国风循环旋律 ============
def make_bgm():
    beat = 0.30
    melody = [
        (0, 0.5, 0.22), (2, 0.5, 0.20), (4, 0.5, 0.22), (7, 0.5, 0.24),
        (9, 1, 0.24), (7, 0.5, 0.22), (4, 0.5, 0.20), (2, 0.5, 0.18),
        (0, 1, 0.22), (4, 0.5, 0.22), (5, 0.5, 0.22), (7, 1, 0.24),
        (9, 0.5, 0.22), (7, 0.5, 0.20), (5, 0.5, 0.20), (4, 0.5, 0.20),
        (2, 0.5, 0.20), (0, 0.5, 0.20), (2, 1, 0.22), (4, 0.5, 0.22),
        (5, 0.5, 0.22), (7, 0.5, 0.24), (9, 1, 0.24), (7, 0.5, 0.22),
        (5, 0.5, 0.20), (4, 0.5, 0.20), (2, 0.5, 0.20), (0, 1.5, 0.22),
    ]
    bass_pattern = [(-12, 2), (-12, 2), (-9, 2), (-7, 2), (-5, 2), (-7, 2), (-9, 2), (-12, 2)]
    total_beat = sum(b for _, b, _ in melody)
    total_sec = total_beat * beat + 0.4
    N = int(total_sec * SAMPLE_RATE)
    buf = [0.0] * N
    t = 0.0
    for st, b, v in melody:
        dur = b * beat
        s1 = single_tone(261.63 * math.pow(2, st/12), dur, v * 0.7, 'triangle', 0.015, 0.08)
        s2 = single_tone(261.63 * math.pow(2, (st+12)/12), dur, v * 0.25, 'sine', 0.02, 0.10)
        si = int(t * SAMPLE_RATE)
        for i in range(len(s1)):
            if si + i < N: buf[si + i] += s1[i] + s2[i]
        t += dur
    bt = 0.0
    for st, b in bass_pattern:
        dur = b * beat
        s = single_tone(261.63 * math.pow(2, st/12), dur, 0.10, 'sine', 0.05, 0.12)
        si = int(bt * SAMPLE_RATE)
        for i in range(len(s)):
            if si + i < N: buf[si + i] += s[i]
        bt += dur
    _wav('bgm.wav', buf)

# ============ 单音音效 ============

def make_place():
    """下子：单个短促木点击（单音，1个干净低频+短促）"""
    _wav('sfx_place.wav', single_tone(880, 0.10, 0.55, 'triangle', 0.002, 0.08))

def make_capture():
    """揪子：单个短促'啵'音（单音）"""
    _wav('sfx_capture.wav', single_tone(600, 0.12, 0.55, 'square', 0.002, 0.10))

def make_move():
    """走子：单个柔和滑音转单音（单音即可）"""
    _wav('sfx_move.wav', single_tone(500, 0.12, 0.5, 'sine', 0.01, 0.10))

def make_reward():
    """成方/成六：单个清脆奖励音（单音高频）"""
    _wav('sfx_reward.wav', single_tone(1046, 0.30, 0.55, 'sine', 0.005, 0.15))

def make_captured():
    """被揪子：单个低沉'咚'音（单音低频）"""
    _wav('sfx_captured.wav', single_tone(160, 0.28, 0.6, 'sine', 0.01, 0.20))

if __name__ == '__main__':
    random.seed(42)
    make_bgm()
    make_place()
    make_capture()
    make_move()
    make_reward()
    make_captured()
    print('All audio files generated (single-tone) to', OUT_DIR)