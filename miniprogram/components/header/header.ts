Component({
  options: {
    virtualHost: true,
  },
  properties: {
    title: {
      type: String,
      value: '',
    },
    showBack: {
      type: Boolean,
      value: false,
    },
  },
  data: {
    statusBarHeight: 0,
  },
  lifetimes: {
    attached() {
      const app = getApp<IAppOption>();
      this.setData({ statusBarHeight: app.globalData.statusBarHeight });
    },
  },
  methods: {
    handleBack() {
      this.triggerEvent('back');
    },
  },
});
