// getUserInfo 云函数 - 获取用户 openid 和基本信息
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const _ = db.command

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()

  const openid = wxContext.OPENID
  const unionid = wxContext.UNIONID

  console.log('getUserInfo 调用: openid =', openid)

  // 查询数据库中的用户信息
  try {
    const userRes = await db.collection('users')
      .where({ _openid: openid })
      .get()

    let user = null

    if (userRes.data.length === 0) {
      // 新用户，创建初始数据
      const newUser = {
        _openid: openid,
        unionid: unionid || '',
        nickname: '',
        avatar: '',
        level: 1,
        score: 500,       // 初始积分
        diamond: 0,       // 铜板
        totalGames: 0,
        winCount: 0,
        loseCount: 0,
        drawCount: 0,
        winStreak: 0,
        maxWinStreak: 0,
        createdAt: new Date(),
        updatedAt: new Date()
      }

      await db.collection('users').add({ data: newUser })
      user = newUser
      console.log('新用户已创建: openid =', openid)
    } else {
      user = userRes.data[0]
      console.log('已有用户: openid =', openid, ', level =', user.level)
    }

    return {
      success: true,
      openid: openid,
      unionid: unionid || '',
      user: user
    }
  } catch (err) {
    console.error('getUserInfo 数据库操作失败:', err)

    // 即使数据库操作失败，也返回 openid
    return {
      success: true,
      openid: openid,
      unionid: unionid || '',
      user: null
    }
  }
}
