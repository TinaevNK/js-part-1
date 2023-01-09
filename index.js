const URL = 'https://restcountries.com/v3.1';

async function getData(url) {
    const response = await fetch(url, {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
        },
        redirect: 'follow',
    });

    const result = await response.json(); // сделал именно таким образом, чтобы достать после message из ответа в случае ошибки

    if (response.ok) {
        return result;
    }

    throw result.message;
}

// для преобразования базы в словарь вида caa3/данные страны. Используем для того, чтобы не бегать за странами на бэк
async function loadCountriesData() {
    const countries = await getData(`${URL}/all?fields=name&fields=cca3&fields=area`);

    if (countries.message) {
        throw new Error(countries.message);
    }

    return countries.reduce((result, country) => {
        result[country.cca3] = country;
        return result;
    }, {});
}

async function getBorders(code) {
    const borders = await getData(`${URL}/alpha/${code}?fields=borders`);

    if (!borders.ok && borders.message) {
        throw new Error(borders.message); // попадёт в catch если произошла ошибка
    }

    return borders.borders;
}

// головная функция
async function search(from, to) {
    const searchData = {
        resultPaths: [], // результат отработки нашей функции, его мы будем парсить в дальнейшем
        overLimit: false, // если страны слишком далеко друг от друга - мы выведем в ответ информацию об этом
        message: '',
        requestData: { requestCounter: 0, error: false }, // счётчик запросов и флаг ошибки
    };

    const paths = [[from]];

    for await (const path of paths) {
        const rootPath = path.at(-1);
        // если мы находим наш путь
        if (rootPath === to) {
            searchData.resultPaths.push(path);
            // теперь поищем другие варианты, если они есть (тоже самое количество шагов)
            const pathNextIndex = paths.indexOf(path) + 1;
            if (paths[pathNextIndex]) {
                for (let i = pathNextIndex; i < paths.length; i++) {
                    if (paths[i].length === path.length) {
                        if (paths[i].at(-1) === to) {
                            searchData.resultPaths.push(paths[i]);
                        }
                    } else {
                        break;
                    }
                }
            }
            return searchData;
        }
        if (path.length > 10) {
            searchData.overLimit = true;
            searchData.message = 'Очень далеко... давай на самолёте?)';
            return searchData;
        }
        let borders;

        try {
            borders = await getBorders(rootPath);
        } catch (err) {
            searchData.message = err;
            searchData.requestData.error = true;
            return searchData;
        }

        searchData.requestData.requestCounter += 1;

        // фильтруем страны, чтобы не идти по кругу
        const nextBorders = borders.filter((border) => {
            for (let i = 0; i < paths.length; i++) {
                if (paths[i].at(-1) === border && paths[i].length <= path.length) {
                    return false;
                }
            }
            return true;
        });

        nextBorders.forEach((border) => {
            const newPath = path.concat(border);
            paths.push(newPath); // вот тут спрятано увеличения стека, путём мутирования paths
        });
    }

    searchData.message = 'К сожалению - ничего не нашлось :(';
    return searchData;
}

const form = document.getElementById('form');
const fromCountry = document.getElementById('fromCountry');
const toCountry = document.getElementById('toCountry');
const countriesList = document.getElementById('countriesList');
const submit = document.getElementById('submit');
const output = document.getElementById('output');

// функция для блокировки/разблокировке полей ввода и кнопки сабмита
const tooggleForm = (bollean) => {
    fromCountry.disabled = bollean;
    toCountry.disabled = bollean;
    submit.disabled = bollean;
};

(async () => {
    tooggleForm(true); // дизейблим кнопки во время запроса

    output.textContent = 'Loading…';

    let countriesData; // вынес в отдельные константы т.к. дальше по коду будет использоваться (т.е. нельзя в {})
    let errorLoading;

    try {
        countriesData = await loadCountriesData();
    } catch (err) {
        errorLoading = true;
    }

    // COMMENT. Как по мне, тут лучше использовать тернарник, на почему линтер его запрещает?
    // или всё же это плохая практика?
    if (errorLoading) {
        output.textContent = 'Упс, произошла ошибка при обращении к серверу, пожалуйста зайдите позже';
    } else {
        output.textContent = '';
    }

    // немного поменял код, чтобы дважды не делать Object.keys, ключи ещё понадобятся
    const countryCodes = Object.keys(countriesData);

    // Заполняем список стран для подсказки в инпутах
    countryCodes
        .sort((a, b) => countriesData[b].area - countriesData[a].area)
        .forEach((code) => {
            const option = document.createElement('option');
            option.value = countriesData[code].name.common;
            countriesList.appendChild(option);
        });

    tooggleForm(false); // делаем раздизейбл по окончании запроса

    form.addEventListener('submit', (e) => {
        e.preventDefault();

        // функция для поиска нужного ключа cca3
        const getCountryCode = (contryFullName) =>
            countryCodes.find((cca3) => contryFullName === countriesData[cca3].name.common);

        // ниже подобие примитивной валидации, не дающей сделать запрос по пустому полю
        if (!fromCountry.value) {
            output.textContent = 'Поле "From" должно быть заполнено:)';
            fromCountry.focus();
        } else if (!toCountry.value) {
            output.textContent = 'Поле "To" должно быть заполнено:)';
            toCountry.focus();
        } else {
            (async () => {
                tooggleForm(true);

                output.textContent = 'Ищем оптимальные маршруты, подождите пожалуйста!';

                const [from, to] = [getCountryCode(fromCountry.value), getCountryCode(toCountry.value)];

                const resultOutput = await search(from, to); // вызов главной функции

                if (resultOutput.requestData.error) {
                    output.textContent = `Произошла ошибка при обращении к серверу ${resultOutput.message}`;
                } else if (resultOutput.overLimit) {
                    output.textContent = resultOutput.message;
                } else if (resultOutput.resultPaths.length) {
                    output.textContent = '';
                    resultOutput.resultPaths.forEach((path) => {
                        path.forEach((country, i) => {
                            path[i] = countriesData[country].name.common;
                        });
                        output.innerHTML += `${path.join(' → ')}<br/>`;
                    });
                    output.innerHTML += `Количество запросов к API: ${resultOutput.requestData.requestCounter}`;
                } else {
                    output.textContent = resultOutput.message;
                }

                tooggleForm(false);
            })();
        }
    });
})();
