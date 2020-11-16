const TelegramBot = require("node-telegram-bot-api");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
var Tx = require("ethereumjs-tx").Transaction;

dotenv.config();

const Web3 = require("web3");

const provider =
    process.env.DEVELOPMENT_MODE == "TRUE"
        ? `https://ropsten.infura.io/v3/${process.env.INFURA_KEY}`
        : `https://mainnet.infura.io/v3/${process.env.INFURA_KEY}`;

const web3 = new Web3(new Web3.providers.HttpProvider(provider));

mongoose
    .connect(process.env.MONGO_URL, {
        useNewUrlParser: true,
    })
    .catch((e) => {
        console.error(e);
    });

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, {
    polling: true,
});

const User = require("./models/User");
const Wallet = require("./models/Wallet");

async function checkUser(msg) {
    var thisuser = await User.find({
        chat_id: msg.from.id,
    });
    if (!thisuser.length) {
        var newuser = new User();
        newuser.chat_id = msg.from.id;
        newuser.username = msg.from.username;
        newuser.isadmin = false;
        newuser.paymentPass = "";
        newuser.position = "mainMenu";
        newuser.language = msg.from.language_code == "ru" ? "ru" : "en";
        await newuser.save();
        thisuser = newuser;
    } else {
        thisuser = thisuser[0];
    }
    return thisuser;
}

bot.on("message", async (msg) => {
    var user = await checkUser(msg);

    const chatId = msg.chat.id;

    if (msg.text == "/start") {
        await mainMenu(user);
    } else {
        if (user.position.indexOf("wait_") + 1) {
            var parse_position = user.position.split("_");
            var isFunc = eval("typeof " + parse_position[1]) == "function";
            if (isFunc) {
                var add_string = "";
                for (
                    let number_of_element = 2;
                    number_of_element < parse_position.length;
                    number_of_element++
                ) {
                    const parse_element = parse_position[number_of_element];
                    add_string += `, '${parse_element}'`;
                }
                eval(`${parse_position[1]}(user, '${msg.text}' ${add_string})`);
            } else {
                console.log(`${parse_position[1]} is not function`);
            }
        }
    }

    bot.deleteMessage(chatId, msg.message_id);
});
bot.on("callback_query", onCallbackQuery);

async function onCallbackQuery(callbackQuery) {
    var action = callbackQuery.data;
    var user = await checkUser(callbackQuery);
    var actionWithId = "";
    if (action.indexOf("_") + 1) {
        actionWithId = action.split("_");
        var isFunc = eval("typeof " + actionWithId[0]) == "function";
        if (isFunc) {
            var add_string = "";
            for (
                let number_of_element = 1;
                number_of_element < actionWithId.length;
                number_of_element++
            ) {
                const parse_element = actionWithId[number_of_element];
                add_string += `, '${parse_element}'`;
            }
            eval(`${actionWithId[0]}(user${add_string})`);
        }
        return true;
    } else {
        var isFunc = eval("typeof " + action) == "function";
        if (isFunc) {
            eval(`${action}(user)`);
        }
        return true;
    }
}

function encryptPrivateKey(privateKey, pass) {
    var cipher = crypto.createCipher("aes256", pass);
    var encrypted = cipher.update(privateKey, "utf8", "hex");
    encrypted += cipher.final("hex");
    return encrypted;
}

function decryptPrivateKey(privateKey, pass) {
    var cipher = crypto.createDecipher("aes256", pass);
    var decrypted = cipher.update(privateKey, "hex", "utf8");
    decrypted += cipher.final("utf8");
    return decrypted;
}

async function editMessage(user, message) {
    if (typeof user.message != "undefined" && user.message.length) {
        bot.deleteMessage(user.chat_id, user.message[0].message_id).catch();
        user.message = [];
        await user.save();
        await editMessage(user, message);
    } else {
        var params = {};

        if (typeof message.inline_keyboard != "undefined") {
            if (typeof params.reply_markup == "undefined") {
                params.reply_markup = {};
            }
            params.reply_markup.inline_keyboard = message.inline_keyboard;
        }

        if (typeof message.parse_mode != "undefined") {
            params.parse_mode = message.parse_mode;
        }

        await bot
            .sendMessage(user.chat_id, message.text, params)
            .then(async (mess) => {
                user.message = mess;
                await user.save();
            })
            .catch();
        return true;
    }
}

async function mainMenu(user, add_msg = "") {
    user.position = "mainMenu";
    await user.save();
    if (user.paymentPass) {
        var myBalance = 0;
        var myWallets = await Wallet.where({ chat_id: user.chat_id });
        for (
            let number_of_wallet = 0;
            number_of_wallet < myWallets.length;
            number_of_wallet++
        ) {
            const oneWallet = myWallets[number_of_wallet];
            await web3.eth.getBalance(oneWallet.address, (a, b) => {
                myBalance += b * 1;
            });
        }
        await editMessage(user, {
            text: `${add_msg}💰 Мой баланс: ${(myBalance / 1e18).toFixed(
                8
            )} ETH`,
            inline_keyboard: [
                [
                    {
                        text: "📂 Мои кошельки",
                        callback_data: "walletsMenu",
                    },
                ],
            ],
            parse_mode: "markdown",
        });
        return true;
    } else {
        await editMessage(user, {
            text:
                "🔐 Пожалуйста установите *платежный пароль*\n\nПлатежный пароль необходим для создания и редактирования ваших кошельков, а также для доступа к операциям с вашими кошельками. Мы не храним ваш платежный пароль в открытом виде, поэтому мы не сможем напомнить вам его, в случае если вы его забудете.",
            inline_keyboard: [
                [
                    {
                        text: "🔑 Задать платежный пароль",
                        callback_data: "setPymentPass",
                    },
                ],
            ],
            parse_mode: "markdown",
        });
        return true;
    }
}

async function setPymentPass(user, add_msg = "") {
    user.position = "wait_enterPaymentPass";
    await user.save();
    await editMessage(user, {
        text: `${add_msg}⌨ Пожалуйста введите новый *Платежный пароль*\n\n⚠ Пожалуйста не забывайте свой платежный пароль, если вы его забудете, то у вас не будет доступа к вашим кошелькам!\nВаш платежный пароль хранится в зашифрованном виде, в случае если вы его забудете, у нас не будет возможности его восстановить.`,
        inline_keyboard: [
            [
                {
                    text: "❌ Отмена",
                    callback_data: "mainMenu",
                },
            ],
        ],
        parse_mode: "markdown",
    });
    return true;
}

async function enterPaymentPass(user, pass) {
    if (pass.length < 4) {
        return setPymentPass(
            user,
            `❌ Минимальная длина пароля - 4 символа\n\n`
        );
    } else {
        bcrypt.genSalt(10, async function (err, salt) {
            bcrypt.hash(pass, salt, async function (err, hash) {
                user.paymentPass = hash;
                await user.save();
                var createWallet = web3.eth.accounts.create();
                var newWallet = new Wallet();
                newWallet.chat_id = user.chat_id;
                newWallet.address = createWallet.address;
                newWallet.encryptedPrivateKey = encryptPrivateKey(
                    createWallet.privateKey,
                    pass
                );
                await newWallet.save();

                return mainMenu(
                    user,
                    `✔ Вы успешно задали *платежный пароль*\n\n✔ Кошелек *${newWallet.address}* создан\n\n`
                );
            });
        });
    }
}

async function walletsMenu(user, page = 0, onOnePage = 5) {
    user.position = "walletsMenu";
    await user.save();
    var wallets = await Wallet.find({ chat_id: user.chat_id });
    var tempMessage = {};
    var n = (page * 1 + 1) * onOnePage - onOnePage;
    var numberofobj = 1;
    var numbersofobj = 0;
    tempMessage.inline_keyboard = [];
    for (var wallet in wallets) {
        numbersofobj++;
        if (numbersofobj > n && numbersofobj < n + onOnePage * 1 + 1) {
            numberofobj++;
            wallet = wallets[wallet];
            await web3.eth.getBalance(wallet.address, (err, balance) => {
                balance = ((balance * 1) / 1e18).toFixed(8);
                tempMessage.inline_keyboard.push([
                    {
                        text: `${wallet.address.substr(
                            0,
                            20
                        )} ...: ${balance} ETH`,
                        callback_data: "selectWallet_" + wallet.id,
                    },
                ]);
            });
        }
    }
    tempMessage.inline_keyboard.push([
        {
            text: "➕ Создать кошелек",
            callback_data: "makeNewWallet",
        },
    ]);
    tempMessage.text = `📃 Список моих кошельков.\nВсего ${numbersofobj} кошельков, страница ${
        page * 1 + 1
    } из ${Math.ceil(numbersofobj / onOnePage)}, кошельки с ${n * 1 + 1} по ${
        (n * 1 + 1,
        n * 1 + onOnePage * 1 > numbersofobj
            ? numbersofobj
            : n * 1 + onOnePage * 1)
    }:`;
    var tempKeyboard = [];
    if (page * 1) {
        tempKeyboard.push({
            text: "◀ Назад",
            callback_data: "walletsMenu_" + (page * 1 - 1),
        });
    }
    if (numbersofobj > n + onOnePage * 1) {
        tempKeyboard.push({
            text: "Вперед ▶",
            callback_data: "walletsMenu_" + (page * 1 + 1),
        });
    }
    if (tempKeyboard.length) {
        tempMessage.inline_keyboard.push(tempKeyboard);
    }
    tempMessage.inline_keyboard.push([
        { text: "🏠 Главное меню", callback_data: "mainMenu" },
    ]);
    await editMessage(user, tempMessage);
    return true;
}

async function selectWallet(user, wallet_id, add_message = "") {
    user.position = `wait_unlockWallet_${wallet_id}`;
    await user.save();
    await editMessage(user, {
        text: `${add_message}⌨ Введите ваш *платежный пароль* для доступа к кошельку:`,
        inline_keyboard: [
            [
                { text: "🏠 Главное меню", callback_data: "mainMenu" },
                {
                    text: "📂 Мои кошельки",
                    callback_data: "walletsMenu",
                },
            ],
        ],
        parse_mode: "markdown",
    });
    return true;
}

async function unlockWallet(user, pass, wallet_id) {
    bcrypt.compare(pass, user.paymentPass, async function (err, result) {
        if (result) {
            return detailWallet(user, wallet_id);
        } else {
            return selectWallet(
                user,
                wallet_id,
                "❌ Вы ввели неверный пароль, попробуйте еще раз\n\n"
            );
        }
    });
}

async function detailWallet(user, wallet_id, add_message = "") {
    user.position = `detailWallet_${wallet_id}`;
    await user.save();
    var wallet = await Wallet.findById(wallet_id);
    await web3.eth.getBalance(wallet.address, async function (err, balance) {
        var link = `https://${
            process.env.DEVELOPMENT_MODE == "TRUE" ? "ropsten." : ""
        }etherscan.io/address/${wallet.address}`;
        var kb =
            balance * 1
                ? [
                      {
                          text: "💸 Отправить",
                          callback_data: `sendMoney_${wallet_id}`,
                      },
                      {
                          text: "📃 История операций",
                          url: link,
                      },
                  ]
                : [
                      {
                          text: "📃 История операций",
                          url: link,
                      },
                  ];
        await editMessage(user, {
            text: `${add_message}💳 Адрес: *${wallet.address}*\n💰 Баланс: *${(
                balance / 1e18
            ).toFixed(8)}*`,
            inline_keyboard: [
                kb,
                [
                    { text: "🏠 Главное меню", callback_data: "mainMenu" },
                    {
                        text: "📂 Мои кошельки",
                        callback_data: "walletsMenu",
                    },
                ],
            ],
            parse_mode: "markdown",
        });
    });
    return true;
}

async function makeNewWallet(user, add_message = "") {
    user.position = `wait_unlockNewWallet`;
    await user.save();
    await editMessage(user, {
        text: `${add_message}⌨ Введите ваш *платежный пароль* для того, чтобы создать новый кошелек:`,
        inline_keyboard: [
            [
                { text: "🏠 Главное меню", callback_data: "mainMenu" },
                {
                    text: "📂 Мои кошельки",
                    callback_data: "walletsMenu",
                },
            ],
        ],
        parse_mode: "markdown",
    });
    return true;
}

async function unlockNewWallet(user, pass) {
    bcrypt.compare(pass, user.paymentPass, async function (err, result) {
        if (result) {
            var createWallet = web3.eth.accounts.create();
            var newWallet = new Wallet();
            newWallet.chat_id = user.chat_id;
            newWallet.address = createWallet.address;
            newWallet.encryptedPrivateKey = encryptPrivateKey(
                createWallet.privateKey,
                pass
            );
            await newWallet.save();
            return detailWallet(user, newWallet._id, "✔ Кошелек создан\n\n");
        } else {
            return makeNewWallet(
                user,
                "❌ Вы ввели неверный пароль, попробуйте еще раз\n\n"
            );
        }
    });
}

async function sendMoney(user, wallet_id, add_message = "") {
    var gasPrice = (await web3.eth.getGasPrice()) * 1.25;
    user.position = `wait_eWa_${wallet_id}_${gasPrice}`;
    await user.save();
    var wallet = await Wallet.findById(wallet_id);
    var comission = 21000 * gasPrice;
    web3.eth.getBalance(wallet.address, async function (err, balance) {
        await editMessage(user, {
            text: `${add_message}💳 Адрес: *${wallet.address}*\n💰 Баланс: *${(
                balance / 1e18
            ).toFixed(8)}*\n💰 Комиссия за перевод: *${(
                comission / 1e18
            ).toFixed(
                8
            )}*\n_Комиссия прибавляется к сумме перевода_\n⌨ Введите сумму перевода:`,
            inline_keyboard: [
                [
                    { text: "🏠 Главное меню", callback_data: "mainMenu" },
                    {
                        text: "💳 Управление кошельком",
                        callback_data: `detailWallet_${wallet_id}`,
                    },
                ],
                [
                    {
                        text: "📂 Мои кошельки",
                        callback_data: "walletsMenu",
                    },
                    {
                        text: `💰 Максимум(${(
                            (balance - comission) /
                            1e18
                        ).toFixed(8)})`,
                        callback_data: `eWa_${(
                            (balance - comission) /
                            1e18
                        ).toFixed(8)}_${wallet_id}_${gasPrice}`,
                    },
                ],
            ],
            parse_mode: "markdown",
        });
    });
}

async function eWa(user, amount, wallet_id, gasPrice, add_message = "") {
    amount = amount.replace(",", ".") * 1e18;
    var wallet = await Wallet.findById(wallet_id);
    var comission = 21000 * gasPrice;
    web3.eth.getBalance(wallet.address, async function (err, balance) {
        if (!Number.isInteger(amount) || balance * 1 < amount + comission) {
            return sendMoney(
                user,
                wallet_id,
                `⚠ Сумма перевода превышает баланс, максимальная сумма перевода *${(
                    (balance - comission) /
                    1e18
                ).toFixed(8)}*\n\n`
            );
        } else {
            user.position = `wait_enterWithdrawAddress_${wallet_id}_${amount}_${gasPrice}`;
            await user.save();
            await editMessage(user, {
                text: `${add_message}💸 Перевод *${(amount / 1e18).toFixed(
                    8
                )}* ETH\n➖ Спишется *${((amount + comission) / 1e18).toFixed(
                    8
                )}* ETH _(Сумма перевода+комиссия)_\n⌨ Введите адрес получателя:`,
                inline_keyboard: [
                    [
                        { text: "🏠 Главное меню", callback_data: "mainMenu" },
                        {
                            text: "💳 Управление кошельком",
                            callback_data: `detailWallet_${wallet_id}`,
                        },
                    ],
                    [
                        {
                            text: "📂 Мои кошельки",
                            callback_data: "walletsMenu",
                        },
                    ],
                ],
                parse_mode: "markdown",
            });
        }
    });
}

async function enterWithdrawAddress(
    user,
    address,
    wallet_id,
    amount,
    gasPrice,
    add_message = ""
) {
    user.position = `wait_enterPaymentPassForWithdraw_${address}_${amount}_${wallet_id}_${gasPrice}`;
    await user.save();
    var comission = 21000 * gasPrice;
    await editMessage(user, {
        text: `${add_message}💸 Перевод *${(amount / 1e18).toFixed(
            8
        )}* ETH\n➖ Спишется *${((amount * 1 + comission) / 1e18).toFixed(
            8
        )}* ETH _(Сумма перевода+комиссия)_\n💳 На адрес: *${address}*\n⌨ Введите платежный пароль для подтверждения перевода _(После ввода пароля отменить операцию будет невозможно)_:`,
        inline_keyboard: [
            [
                { text: "🏠 Главное меню", callback_data: "mainMenu" },
                {
                    text: "💳 Управление кошельком",
                    callback_data: `detailWallet_${wallet_id}`,
                },
            ],
            [
                {
                    text: "📂 Мои кошельки",
                    callback_data: "walletsMenu",
                },
            ],
        ],
        parse_mode: "markdown",
    });
}

async function enterPaymentPassForWithdraw(
    user,
    pass,
    address,
    amount,
    wallet_id,
    gasPrice,
    add_message = ""
) {
    bcrypt.compare(pass, user.paymentPass, async function (err, result) {
        if (result) {
            editMessage(user, { text: "Операция выполняется..." });
            var wallet = await Wallet.findById(wallet_id);
            var pk = decryptPrivateKey(wallet.encryptedPrivateKey, pass);
            var privateKey = Buffer.from(pk.substring(2, 66), "hex");
            var nonce = await web3.eth.getTransactionCount(wallet.address);
            var rawTx = {
                nonce: `0x${new web3.utils.BN(nonce).toString(16)}`,
                gasPrice: `0x${new web3.utils.BN(gasPrice).toString(16)}`,
                gasLimit: `0x${new web3.utils.BN(21000).toString(16)}`,
                to: address,
                value: `0x${new web3.utils.BN(amount).toString(16)}`,
                data: "0x",
            };
            try {
                var tx = new Tx(rawTx, {
                    chain:
                        process.env.DEVELOPMENT_MODE == "TRUE"
                            ? "ropsten"
                            : "mainnet",
                });
                tx.sign(privateKey);
                var serializedTx = tx.serialize();
                web3.eth
                    .sendSignedTransaction("0x" + serializedTx.toString("hex"))
                    .on("receipt", async function (operation) {
                        link = `https://${
                            process.env.DEVELOPMENT_MODE == "TRUE"
                                ? "ropsten."
                                : ""
                        }etherscan.io/tx/${operation.transactionHash}`;
                        return await detailWallet(
                            user,
                            wallet_id,
                            `✔ Операция выполнена, детали операции доступны по [ссылке](${link})\n\n`
                        );
                    });
            } catch (err) {
                return await detailWallet(
                    user,
                    wallet_id,
                    `❌ Произошла ошибка, проверьте все параметры и повторите перевод\n\n`
                );
            }
        } else {
            return enterWithdrawAddress(
                user,
                address,
                wallet_id,
                amount,
                gasPrice,
                "❌ Вы ввели неверный пароль, попробуйте еще раз\n\n"
            );
        }
    });
}
