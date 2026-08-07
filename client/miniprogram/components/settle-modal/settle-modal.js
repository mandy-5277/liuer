// components/settle-modal/settle-modal.js
Component({
  properties: {
    visible: {
      type: Boolean,
      value: false,
    },
    result: {
      type: String, // 'win' | 'lose' | 'draw'
      value: 'win',
    },
    score: {
      type: Number,
      value: 0,
    },
    reason: {
      type: String,
      value: '', // CHECKMATE | SURRENDER | TIMEOUT | DRAW_AGREE | DRAW_FIVE | DRAW_NATURAL
    },
    details: {
      type: Array,
      value: [],
    },
    rankName: {
      type: String,
      value: '初级小六',
    },
    rankScore: {
      type: Number,
      value: -1, // -1 表示不显示
    },
  },

  observers: {
    'result, reason, score': function (result, reason, score) {
      let winSubtitle = '大获全胜';
      let loseSubtitle = '再接再厉';
      let drawSubtitle = '势均力敌';
      let scoreText = '';

      // 服务端 endReason: 'checkmate' | 'surrender' | 'timeout' | 'draw_agree' | 'draw_five'
      if (result === 'win') {
        if (reason === 'checkmate') {
          winSubtitle = '对方无子可走，困毙胜！';
        } else if (reason === 'surrender') {
          winSubtitle = '对手认输，你获胜了！';
        } else if (reason === 'timeout') {
          winSubtitle = '对手超时，你获胜了！';
        } else {
          winSubtitle = '大获全胜';
        }
        scoreText = '+' + score + ' 积分';
      } else if (result === 'lose') {
        if (reason === 'checkmate') {
          loseSubtitle = '无子可走，困毙败';
        } else if (reason === 'surrender') {
          loseSubtitle = '你已认输';
        } else if (reason === 'timeout') {
          loseSubtitle = '超时告负';
        } else {
          loseSubtitle = '再接再厉';
        }
        scoreText = score + ' 积分';
      } else if (result === 'draw') {
        if (reason === 'draw_agree') {
          drawSubtitle = '双方同意求和';
        } else if (reason === 'draw_five') {
          drawSubtitle = '自然和棋（连续5回合无有效揪）';
        } else {
          drawSubtitle = '势均力敌';
        }
        scoreText = (score > 0 ? '+' : '') + score + ' 积分';
      }

      this.setData({ winSubtitle, loseSubtitle, drawSubtitle, scoreText });
    },
  },

  lifetimes: {
    attached() {
      this._scoreText = '';
    },
  },

  methods: {
    noop() {},

    onRematch() {
      this.triggerEvent('rematch');
    },

    onGoHome() {
      this.triggerEvent('close');
    },

    onShare() {
      this.triggerEvent('share');
    },
  },
});
