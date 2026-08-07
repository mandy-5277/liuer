// components/modal/modal.js
Component({
  properties: {
    visible: {
      type: Boolean,
      value: false,
    },
    title: {
      type: String,
      value: '',
    },
    confirmText: {
      type: String,
      value: '',
    },
    cancelText: {
      type: String,
      value: '',
    },
    showFooter: {
      type: Boolean,
      value: false,
    },
  },

  methods: {
    noop() {},

    onClose() {
      this.triggerEvent('close');
    },

    onConfirm() {
      this.triggerEvent('confirm');
    },

    onCancel() {
      this.triggerEvent('cancel');
    },
  },
});
